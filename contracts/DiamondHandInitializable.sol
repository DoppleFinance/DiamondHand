// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./Ownable.sol";
import "./ReentrancyGuard.sol";
import "./SafeMath.sol";
import "./SafeBEP20.sol";
import "./IBEP20.sol";

contract DiamondHandInitializableV2 is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeBEP20 for IBEP20;

    // The address of the dividend deployer
    address public immutable DIVIDEND_DEPLOYER;

    // The max penalty percentage
    uint256 public constant MAX_PENALTY_PERCENTAGE = 5e16; // 5e16 or 5%
    
    // The address to collect the fees when a user withdraw within the penalty period
    address public feeTo;

    // Whether a limit is set for users
    bool public hasUserLimit;

    // Whether it is initialized
    bool public isInitialized;

    // Accrued token per share
    uint256 public accTokenPerShare;

    // The block number when DOPPLE mining ends.
    uint256 public bonusEndBlock;

    // The block number when DOPPLE mining starts.
    uint256 public startBlock;

    // The block number of the last pool update
    uint256 public lastRewardBlock;

    // The pool limit (0 if none)
    uint256 public poolLimitPerUser;

    // DOPPLE tokens created per block.
    uint256 public rewardPerBlock;

    // The precision factor
    uint256 public PRECISION_FACTOR;

    // The reward token
    IBEP20 public rewardToken;

    // The staked token
    IBEP20 public stakedToken;

    // The remaining reward
    uint256 public stakingCount;

    // The penalty reward blocks
    uint256 public penaltyPeriodBlocks;

    // The penalty percentage
    uint256 public penaltyPercentage; //1e16 or 1%

    // Info of each user that stakes tokens (stakedToken)
    mapping(address => UserInfo) public userInfo;

    struct UserInfo {
        uint256 amount; // How many staked tokens the user has provided
        uint256 rewardDebt; // Reward debt
        uint256 depositBlock; // Latest deposit block
    }

    event AdminTokenRecovery(address tokenRecovered, uint256 amount);
    event Deposit(address indexed user, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 amount);
    event NewStartAndEndBlocks(uint256 startBlock, uint256 endBlock);
    event NewRewardPerBlock(uint256 rewardPerBlock);
    event NewPoolLimit(uint256 poolLimitPerUser);
    event RewardsStop(uint256 blockNumber);
    event AdminWithdraw(uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event DepositReward(uint256 amount);
    event SetPenaltyPercentage(uint256 oldPercentage, uint256 newPercentage);
    event SetPenaltyPeriodBlocks(uint256 oldBlocks, uint256 newBlocks);
    event SetFeeTo(address oldAddress, address newAddress);
    event Harvest(address user);

    constructor() public {
        DIVIDEND_DEPLOYER = msg.sender;
    }

    /*
     * @notice Initialize the contract
     * @param _stakedToken: staked token address
     * @param _rewardToken: reward token address
     * @param _rewardPerBlock: reward per block (in rewardToken)
     * @param _startBlock: start block
     * @param _bonusEndBlock: end block
     * @param _poolLimitPerUser: pool limit per user in stakedToken (if any, else 0)
     * @param _admin: admin address with ownership
     */
    function initialize(
        IBEP20 _stakedToken,
        IBEP20 _rewardToken,
        uint256 _rewardPerBlock,
        uint256 _startBlock,
        uint256 _bonusEndBlock,
        uint256 _poolLimitPerUser,
        address _admin
    ) external {
        require(!isInitialized, "DiamondHandInitializable::initialize: Already initialized");
        require(msg.sender == DIVIDEND_DEPLOYER, "DiamondHandInitializable::initialize: Not deployer");

        // Make this contract initialized
        isInitialized = true;

        stakedToken = _stakedToken;
        rewardToken = _rewardToken;
        rewardPerBlock = _rewardPerBlock;
        startBlock = _startBlock;
        bonusEndBlock = _bonusEndBlock;
        feeTo = _admin;

        stakingCount = 0;

        // Adjustable
        penaltyPeriodBlocks = 403200; // 14 days
        penaltyPercentage = 10000000000000000; // 1e16 or 1%

        if (_poolLimitPerUser > 0) {
            hasUserLimit = true;
            poolLimitPerUser = _poolLimitPerUser;
        }

        uint256 decimalsRewardToken = uint256(rewardToken.decimals());
        require(decimalsRewardToken < 30, "DiamondHandInitializable::initialize: Must be inferior to 30");

        PRECISION_FACTOR = uint256(10**(uint256(30).sub(decimalsRewardToken)));

        // Set the lastRewardBlock as the startBlock
        lastRewardBlock = startBlock;

        // Transfer ownership to the admin address who becomes owner of the contract
        transferOwnership(_admin);
    }

    /*
     * @notice setPenaltyPeriodBlocks update penalty period blocks
     * @params _blocks penalty reward blocks
    */

    function setPenaltyPeriodBlocks(uint256 _blocks) external onlyOwner {
        uint256 _oldPeriod = penaltyPeriodBlocks;
        penaltyPeriodBlocks = _blocks;

        emit SetPenaltyPeriodBlocks(_oldPeriod, _blocks);
    }

    /*
     * @notice setPenaltyPercentage update penalty percentage
     * @params _percentage penalty percentage in 1e18 decimals eg. 10000000000000000 or 1e16 is 1%
    */

    function setPenaltyPercentage(uint256 _percentage) external onlyOwner {
        require(_percentage <= MAX_PENALTY_PERCENTAGE, "DividendInitializable::setPenaltyPercentage: Penalty percentage must below or equal MAX_PENALTY_PERCENTAGE");

        uint256 _oldPercentage = penaltyPercentage;
        penaltyPercentage = _percentage;

        emit SetPenaltyPercentage(_oldPercentage, _percentage);
    }

    /*
     * @notice setFeeTo update address to receive fee
     * @params _newAddress the new address
    */

    function setFeeTo(address _newAddress) external onlyOwner {
        address _oldAddress = feeTo;
        feeTo = _newAddress;

        emit SetFeeTo(_oldAddress, _newAddress);
    }

    /*
     * @notice isUserInPenaltyPeriod checks if user will get withdraw fee
     * @params _user user address
     * @returns penalty is user in penalty period
     */
    function isUserInPenaltyPeriod(address _user) public view returns (bool penalty) {
        UserInfo storage user = userInfo[_user];
        penalty = (block.number <= user.depositBlock.add(penaltyPeriodBlocks));
    }

    /*
     * @notice Deposit staked tokens and collect reward tokens (if any)
     * @param _amount: amount to withdraw (in rewardToken)
     */
    function deposit(uint256 _amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];

        if (hasUserLimit) {
            require(
                _amount.add(user.amount) <= poolLimitPerUser,
                "User amount above limit"
            );
        }

        _updatePool();

        if (user.amount > 0) {
            uint256 pending = user.amount
                .mul(accTokenPerShare)
                .div(PRECISION_FACTOR)
                .sub(user.rewardDebt);

            if (pending > 0) {
                rewardToken.safeTransfer(msg.sender, pending);
            }
        }

        if (_amount > 0) {
            user.amount = user.amount.add(_amount);
            stakingCount = stakingCount.add(_amount);

            stakedToken.safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );
        }

        user.depositBlock = block.number;
        user.rewardDebt = user.amount.mul(accTokenPerShare).div(
            PRECISION_FACTOR
        );

        emit Deposit(msg.sender, _amount);
    }

    /*
     * @notice Deposit reward by admin
     * @param _amount: amount to deposit
     */
    function depositReward(uint256 _amount) external nonReentrant onlyOwner {
        require(rewardToken.balanceOf(msg.sender) >= _amount, "DiamondHandInitializable::depositReward: Insufficient balance");
        rewardToken.safeTransferFrom(msg.sender, address(this), _amount);

        emit DepositReward(_amount);
    }

    /*
     * @notice Harvest reward
     */
    function harvest() external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        
        _updatePool();

        if (user.amount > 0) {
            uint256 pending =
                user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR).sub(
                    user.rewardDebt
                );
            if (pending > 0) {
                rewardToken.safeTransfer(msg.sender, pending);
            }
        }

        user.rewardDebt = user.amount.mul(accTokenPerShare).div(
            PRECISION_FACTOR
        );

        emit Harvest(msg.sender);
    }

    /*
     * @notice Withdraw staked tokens and collect reward tokens
     * @param _amount: amount to withdraw (in rewardToken)
     */
    function withdraw(uint256 _amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        require(user.amount >= _amount, "DiamondHandInitializable::withdraw: Amount to withdraw too high");

        _updatePool();

        uint256 pending =
            user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR).sub(
                user.rewardDebt
            );

        if (_amount > 0) {
            user.amount = user.amount.sub(_amount);
            if (isUserInPenaltyPeriod(msg.sender)) {
                uint256 withdrawAmount = _amount.mul(uint256(1e18).sub(penaltyPercentage)).div(1e18);
                
                // transfer remainning amount to user
                stakedToken.safeTransfer(msg.sender, withdrawAmount);

                // transfer fee to feeTo
                stakedToken.safeTransfer(feeTo, _amount.sub(withdrawAmount));
            } else {
                stakedToken.safeTransfer(msg.sender, _amount);
            }

            stakingCount = stakingCount.sub(_amount);
        }

        if (pending > 0) {
            rewardToken.safeTransfer(msg.sender, pending);
        }

        user.rewardDebt = user.amount.mul(accTokenPerShare).div(
            PRECISION_FACTOR
        );

        emit Withdraw(msg.sender, _amount);
    }

    /*
     * @notice Admin withdraw only reward token in emergency case. 
     * @notice Admin cannot withdraw user's funds, SAFU!
     * @dev Needs to be for emergency.
     * @param _amount amount to withdraw
     */
    function adminWithdraw(uint256 _amount) external nonReentrant onlyOwner {
        require(_amount > 0, "DiamondHandInitializable::adminWithdraw: _amount should be higher than 0");
        require(_amount <= getTotalRemainingReward(), "DiamondHandInitializable::adminWithdraw: _amount should be less than or equal the total remaining reward");
        rewardToken.safeTransfer(msg.sender, _amount);

        emit AdminWithdraw(_amount);
    }

    /*
     * @notice Withdraw staked tokens without caring about rewards rewards
     * @dev Needs to be for emergency.
     */
    function emergencyWithdraw() external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        uint256 amountToTransfer = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;

        if (amountToTransfer > 0) {
            if (isUserInPenaltyPeriod(msg.sender)) {
                uint256 withdrawAmount = amountToTransfer.mul(uint256(1e18).sub(penaltyPercentage)).div(1e18);
                
                // transfer remainning amount to user
                stakedToken.safeTransfer(msg.sender, withdrawAmount);

                // transfer fee to feeTo
                stakedToken.safeTransfer(feeTo, amountToTransfer.sub(withdrawAmount));
            } else {
                stakedToken.safeTransfer(msg.sender, amountToTransfer);
            }
            stakingCount = stakingCount.sub(amountToTransfer);
        }

        emit EmergencyWithdraw(msg.sender, user.amount);
    }

    /**
     * @notice It allows the admin to recover wrong tokens sent to the contract
     * @param _tokenAddress: the address of the token to withdraw
     * @param _tokenAmount: the number of tokens to withdraw
     * @dev This function is only callable by admin.
     */
    function recoverWrongTokens(address _tokenAddress, uint256 _tokenAmount)
        external
        onlyOwner
    {
        require(
            _tokenAddress != address(stakedToken),
            "DiamondHandInitializable::recoverWrongTokens: Cannot be staked token"
        );
        require(
            _tokenAddress != address(rewardToken),
            "DiamondHandInitializable::recoverWrongTokens: Cannot be reward token"
        );

        IBEP20(_tokenAddress).safeTransfer(msg.sender, _tokenAmount);

        emit AdminTokenRecovery(_tokenAddress, _tokenAmount);
    }

    /*
     * @notice Stop rewards
     * @dev Only callable by owner
     */
    function stopReward() external onlyOwner {
        bonusEndBlock = block.number;
    }

    /*
     * @notice Update pool limit per user
     * @dev Only callable by owner.
     * @param _hasUserLimit: whether the limit remains forced
     * @param _poolLimitPerUser: new pool limit per user
     */
    function updatePoolLimitPerUser(
        bool _hasUserLimit,
        uint256 _poolLimitPerUser
    ) external onlyOwner {
        require(hasUserLimit, "DiamondHandInitializable::updatePoolLimitPerUser: Must be set");
        if (_hasUserLimit) {
            require(
                _poolLimitPerUser > poolLimitPerUser,
                "DiamondHandInitializable::updatePoolLimitPerUser: New limit must be higher"
            );
            poolLimitPerUser = _poolLimitPerUser;
        } else {
            hasUserLimit = _hasUserLimit;
            poolLimitPerUser = 0;
        }
        emit NewPoolLimit(poolLimitPerUser);
    }

    /*
     * @notice Update reward per block
     * @dev Only callable by owner.
     * @param _rewardPerBlock: the reward per block
     */
    function updateRewardPerBlock(uint256 _rewardPerBlock) external onlyOwner {
        rewardPerBlock = _rewardPerBlock;
        emit NewRewardPerBlock(_rewardPerBlock);
    }

    /**
     * @notice It allows the admin to update start and end blocks
     * @dev This function is only callable by owner.
     * @param _startBlock: the new start block
     * @param _bonusEndBlock: the new end block
     */
    function updateStartAndEndBlocks(
        uint256 _startBlock,
        uint256 _bonusEndBlock
    ) external onlyOwner {
        require(
            _startBlock < _bonusEndBlock,
            "DiamondHandInitializable::updateStartAndEndBlocks: New startBlock must be lower than new endBlock"
        );

        startBlock = _startBlock;
        bonusEndBlock = _bonusEndBlock;

        // Set the lastRewardBlock as the startBlock
        lastRewardBlock = startBlock;

        emit NewStartAndEndBlocks(_startBlock, _bonusEndBlock);
    }

    /*
     * @notice View function to see pending reward on frontend.
     * @param _user: user address
     * @return Pending reward for a given user
     */
    function pendingReward(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        uint256 stakedTokenSupply = stakingCount;
        if (block.number > lastRewardBlock && stakedTokenSupply != 0) {
            uint256 multiplier = _getMultiplier(lastRewardBlock, block.number);
            uint256 doppleReward = multiplier.mul(rewardPerBlock);
            uint256 adjustedTokenPerShare =
                accTokenPerShare.add(
                    doppleReward.mul(PRECISION_FACTOR).div(stakedTokenSupply)
                );
            return
                user
                    .amount
                    .mul(adjustedTokenPerShare)
                    .div(PRECISION_FACTOR)
                    .sub(user.rewardDebt);
        } else {
            return
                user.amount.mul(accTokenPerShare).div(PRECISION_FACTOR).sub(
                    user.rewardDebt
                );
        }
    }

    /*
     * @notice Update reward variables of the given pool to be up-to-date.
     */
    function _updatePool() internal {
        if (block.number <= lastRewardBlock) {
            return;
        }

        uint256 stakedTokenSupply = stakingCount;

        if (stakedTokenSupply == 0) {
            lastRewardBlock = block.number;
            return;
        }

        uint256 multiplier = _getMultiplier(lastRewardBlock, block.number);
        uint256 doppleReward = multiplier.mul(rewardPerBlock);
        accTokenPerShare = accTokenPerShare.add(
            doppleReward.mul(PRECISION_FACTOR).div(stakedTokenSupply)
        );
        lastRewardBlock = block.number;
    }

    /*
     * @notice Return reward multiplier over the given _from to _to block.
     * @param _from: block to start
     * @param _to: block to finish
     */
    function _getMultiplier(uint256 _from, uint256 _to)
        internal
        view
        returns (uint256)
    {
        if (_to <= bonusEndBlock) {
            return _to.sub(_from);
        } else if (_from >= bonusEndBlock) {
            return 0;
        } else {
            return bonusEndBlock.sub(_from);
        }
    }

    /*
     * @notice Return total remaining reward
     */
    function getTotalRemainingReward()
        public
        view
        returns (uint256 totalRemainingReward)
    {
        require(address(rewardToken) != address(0), "DiamondHandInitializable::updateStartAndEndBlocks: Can not transfer of zero token");
        
        if(address(stakedToken) == address(rewardToken)){
            totalRemainingReward = rewardToken.balanceOf(address(this)).sub(stakingCount);
        } else {
            totalRemainingReward = rewardToken.balanceOf(address(this));
        }
    }
}
