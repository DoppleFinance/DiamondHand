const { expect, assert } = require('chai');
const { getNamedAccounts, ethers } = require('hardhat');

describe('Devidend', async () => {
    let deployer, user;

    before(async () => {
        await deployments.fixture();
        const namedAccounts = await getNamedAccounts();
        deployer = namedAccounts.deployer;
        user = namedAccounts.user;
    });

    it('Can deploy dividend contract', async () => {
        const DiamondHandInitializable = await ethers.getContractFactory('DiamondHandInitializable');
        const devidend = await DiamondHandInitializable.deploy();
        assert.ok(devidend);

        console.log('devidend address', devidend.address);
    });

    it('Can initialize the contract', async () => {
        const DiamondHandInitializable = await ethers.getContract('DiamondHandInitializable');
        const DoppleToken = await ethers.getContract('DoppleToken');
        const _stakedToken = DoppleToken.address;
        const _rewardToken = DoppleToken.address;
        const _rewardPerBlock = 50;
        const _startBlock = '1000';
        const _bonusEndBlock = '1500';
        const _poolLimitPerUser = ethers.utils.parseEther('1000');
        const _admin = deployer;
        const result = await DiamondHandInitializable.initialize(_stakedToken, _rewardToken, _rewardPerBlock, _startBlock, _bonusEndBlock, _poolLimitPerUser, _admin);
        assert.ok(result);

    });

    it('Can transfer Dopple from admin to user', async () => {
        const DoppleToken = await ethers.getContract('DoppleToken');
        const oldUserBalance = await DoppleToken.balanceOf(user);
        const transferAmount = ethers.utils.parseEther('1000');
        const result = await DoppleToken.transfer(user, transferAmount);
        assert.ok(result);

        const newUserBalance = await DoppleToken.balanceOf(user);
        expect(newUserBalance).eq(oldUserBalance.add(transferAmount));
    });

    it('Can deposit Dopple by user', async () => {
        const DoppleToken = await ethers.getContract('DoppleToken', user);
        const DiamondHandInitializable = await ethers.getContract('DiamondHandInitializable', user);
        const depositAmount = ethers.utils.parseEther('100');
        const oldDepositedAmount = await DiamondHandInitializable.userInfo(user);
        const allowance = await DoppleToken.allowance(user, DiamondHandInitializable.address);
        if (allowance.lte(depositAmount)) {
            await DoppleToken.approve(DiamondHandInitializable.address, ethers.constants.MaxUint256);
        }
        const result = await DiamondHandInitializable.deposit(depositAmount);
        assert.ok(result);

        const newDepositedAmount = await DiamondHandInitializable.userInfo(user);
        expect(newDepositedAmount.amount).eq(oldDepositedAmount.amount.add(depositAmount));
    });
});
