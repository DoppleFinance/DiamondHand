const { expect } = require("chai");
const { expectRevert, time } = require("@openzeppelin/test-helpers");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");

const fastForwardBlock = (number) => {
  const promises = [];
  for (let i = 0; i <= number; i++) {
    promises.push(ethers.provider.send("evm_mine"));
  }
  return Promise.all(promises);
};

const fastForwardToBlock = async (number) => {
  const now = await ethers.provider.getBlockNumber();
  return fastForwardBlock(number - now);
};

// await ethers.provider.send("evm_increaseTime", [3600]); // add 3600 seconds
// await ethers.provider.send("evm_mine"); // mine the next block

describe("#New function dividend", async () => {
  let dividend;

  beforeEach(async () => {
    await deployments.fixture();
    const [owner, holder1, holder2] = await ethers.getSigners();

    const DiamondHandInitializable = await ethers.getContractFactory(
      "DiamondHandInitializable"
    );

    dividend = await DiamondHandInitializable.deploy();
    await dividend.deployed();

    const DoppleToken = await ethers.getContract("DoppleToken");
    const DoppleHolder1 = await ethers.getContract(
      "DoppleToken",
      holder1.address
    );
    const DoppleHolder2 = await ethers.getContract(
      "DoppleToken",
      holder2.address
    );

    await DoppleToken.mint(owner.address, ethers.utils.parseEther("5000000"));
    await DoppleToken.mint(holder1.address, ethers.utils.parseEther("1000000"));
    await DoppleToken.mint(holder2.address, ethers.utils.parseEther("2000000"));

    await DoppleToken.approve(dividend.address, ethers.constants.MaxUint256);
    await DoppleHolder1.approve(dividend.address, ethers.constants.MaxUint256);
    await DoppleHolder2.approve(dividend.address, ethers.constants.MaxUint256);

    const _stakedToken = DoppleToken.address;
    const _rewardToken = DoppleToken.address;
    const _rewardPerBlock = ethers.utils.parseEther("100");
    // const _rewardPerBlock = ethers.utils.parseEther("0");
    const _startBlock = "100";
    const _bonusEndBlock = "5000000";
    const _poolLimitPerUser = "0";
    const _admin = owner.address;

    const initTx = await dividend.initialize(
      _stakedToken,
      _rewardToken,
      _rewardPerBlock,
      _startBlock,
      _bonusEndBlock,
      _poolLimitPerUser,
      _admin
    );
    await initTx.wait();
  });

  it("should get zero at first pending reward", async () => {
    const [, holder1] = await ethers.getSigners();
    const reward = await dividend.pendingReward(holder1.address);
    expect(reward.toString()).to.equal("0");
  });

  it("should get 99% if withdraw before startBlock", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");

    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    await fastForwardToBlock(50);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);
    await dividend.connect(holder1).withdraw(one);
    const holder1Balance = await DoppleToken.balanceOf(holder1.address);
    const after = ethers.utils.formatEther(holder1Balance);
    expect(after.toString()).to.equal("999999.99");
  });

  it("should get 200 pending reward at 101rd block to only a holder1", async () => {
    const one = ethers.utils.parseEther("1");
    const fiveHundredThousand = ethers.utils.parseEther("500000");

    const [owner, holder1] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    const rawHolder1Balance = await DoppleToken.balanceOf(holder1.address);
    const holder1Balance = ethers.utils.formatEther(rawHolder1Balance);

    const beforeRewardAmount = await DoppleToken.balanceOf(dividend.address);
    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    const rewardAmount = await DoppleToken.balanceOf(dividend.address);

    const beforeUserInfo = await dividend.userInfo(holder1.address);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    const userInfo = await dividend.userInfo(holder1.address);
    const deposited = userInfo[0];

    await fastForwardToBlock(101);

    const reward = await dividend.pendingReward(holder1.address);

    expect(holder1Balance).to.equal("1000000.0");
    expect(beforeRewardAmount).to.equal("0");
    expect(rewardAmount).to.equal(fiveHundredThousand);
    expect(beforeUserInfo[0]).to.equal("0");
    expect(ethers.utils.formatEther(deposited)).to.equal("1.0");
    expect(ethers.utils.formatEther(reward.toString())).to.equal("200.0");
  });

  it("should get pending reward at 101rd block to holder1 and holder2 are staked", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");

    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    const rawHolder1Balance = await DoppleToken.balanceOf(holder1.address);
    const holder1Balance = ethers.utils.formatEther(rawHolder1Balance);

    const beforeRewardAmount = await DoppleToken.balanceOf(dividend.address);
    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    const rewardAmount = await DoppleToken.balanceOf(dividend.address);

    const beforeUserInfo = await dividend.userInfo(holder1.address);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    // holder 2 put deposit stake token to dividend's contract
    await dividend.connect(holder2).deposit(three);

    await fastForwardToBlock(101);

    const rewardHolder1 = await dividend.pendingReward(holder1.address);
    const rewardHolder2 = await dividend.pendingReward(holder2.address);

    expect(holder1Balance).to.equal("1000000.0");
    expect(beforeRewardAmount).to.equal("0");
    expect(rewardAmount).to.equal(fiveHundredThousand);
    expect(beforeUserInfo[0]).to.equal("0");
    expect(ethers.utils.formatEther(rewardHolder1.toString())).to.equal("50.0");
    expect(ethers.utils.formatEther(rewardHolder2.toString())).to.equal(
      "150.0"
    );
  });

  it("should not get reward if remaining reward = 0", async () => {
    const one = ethers.utils.parseEther("1");
    const fiveHundredThousand = ethers.utils.parseEther("500000");

    const [owner, holder1] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    const rawHolder1Balance = await DoppleToken.balanceOf(holder1.address);
    const holder1Balance = ethers.utils.formatEther(rawHolder1Balance);

    const beforeRewardAmount = await DoppleToken.balanceOf(dividend.address);
    // owner depositReward to dividend's contract
    // await dividend.connect(owner).depositReward(fiveHundredThousand);

    const beforeUserInfo = await dividend.userInfo(holder1.address);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    const userInfo = await dividend.userInfo(holder1.address);
    const deposited = userInfo[0];

    await fastForwardToBlock(101);

    const reward = await dividend.pendingReward(holder1.address);

    expect(holder1Balance).to.equal("1000000.0");
    expect(beforeRewardAmount).to.equal("0");
    expect(beforeUserInfo[0]).to.equal("0");
    expect(ethers.utils.formatEther(deposited)).to.equal("1.0");
    expect(ethers.utils.formatEther(reward.toString())).to.equal("0.0");
  });

  it("should get only 99% amount if withdraw within penalty period", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    const rewardAmount = await DoppleToken.balanceOf(dividend.address);
    expect(rewardAmount).to.equal(fiveHundredThousand);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    // holder 2 put deposit stake token to dividend's contract
    await dividend.connect(holder2).deposit(one);

    await fastForwardToBlock(103);

    const beforeHolder1Balance = await DoppleToken.balanceOf(holder1.address);
    const before = ethers.utils.formatEther(beforeHolder1Balance);

    const beforeBlock = await ethers.provider.getBlockNumber();

    let rewardHolder1 = await dividend.pendingReward(holder1.address);
    rewardHolder1 = ethers.utils.formatEther(rewardHolder1.toString());

    await dividend.connect(holder1).withdraw(one);
    const holder1Balance = await DoppleToken.balanceOf(holder1.address);
    const after = ethers.utils.formatEther(holder1Balance);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    expect(before).to.equal("999999.0");
    // 999999.0 + 0.99 + 250
    expect(after).to.equal("1000249.99");
  });

  it("should get 1% fee if someone withdraw within penalty period", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    // update rewardPerBlock to 0
    await dividend.updateRewardPerBlock("0");

    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    const rewardAmount = await DoppleToken.balanceOf(dividend.address);
    expect(rewardAmount).to.equal(fiveHundredThousand);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    // holder 2 put deposit stake token to dividend's contract
    await dividend.connect(holder2).deposit(one);

    const beforeHolder1Balance = await DoppleToken.balanceOf(holder1.address);
    const before = ethers.utils.formatEther(beforeHolder1Balance);

    let rewardHolder1 = await dividend.pendingReward(holder1.address);
    rewardHolder1 = ethers.utils.formatEther(rewardHolder1.toString());

    let beforeOwnerBalance = await DoppleToken.balanceOf(owner.address);
    beforeOwnerBalance = ethers.utils.formatEther(beforeOwnerBalance);

    await dividend.connect(holder1).withdraw(one);

    let afterOwnerBalance = await DoppleToken.balanceOf(owner.address);
    afterOwnerBalance = ethers.utils.formatEther(afterOwnerBalance);

    const holder1Balance = await DoppleToken.balanceOf(holder1.address);
    const after = ethers.utils.formatEther(holder1Balance);

    expect(beforeOwnerBalance).to.equal("4510000.0");
    expect(afterOwnerBalance).to.equal("4510000.01");

    expect(before).to.equal("999999.0");
    // 999999.0 + 0.99
    expect(after).to.equal("999999.99");
  });

  it("should get 1% fee to set feeTo if someone withdraw within penalty period", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const [owner, holder1, holder2, feeTo] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    await dividend.setFeeTo(feeTo.address);

    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    const rewardAmount = await DoppleToken.balanceOf(dividend.address);
    expect(rewardAmount).to.equal(fiveHundredThousand);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    // holder 2 put deposit stake token to dividend's contract
    await dividend.connect(holder2).deposit(three);

    let beforeOwnerBalance = await DoppleToken.balanceOf(feeTo.address);
    beforeOwnerBalance = ethers.utils.formatEther(beforeOwnerBalance);

    await dividend.connect(holder1).withdraw(one);
    await dividend.connect(holder2).withdraw(three);

    let afterOwnerBalance = await DoppleToken.balanceOf(feeTo.address);
    afterOwnerBalance = ethers.utils.formatEther(afterOwnerBalance);

    expect(beforeOwnerBalance).to.equal("0.0");
    expect(afterOwnerBalance).to.equal("0.04");
  });

  it("isUserInPenaltyPeriod  (14 days)", async () => {
    const one = ethers.utils.parseEther("1");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const penaltyPeriodBlocks = 100;
    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    const rewardAmount = await DoppleToken.balanceOf(dividend.address);
    expect(rewardAmount).to.equal(fiveHundredThousand);
    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);
    const holder1UserInfo = await dividend.userInfo(holder1.address);

    expect(await dividend.isUserInPenaltyPeriod(holder1.address), true);

    await fastForwardBlock(
      parseInt(holder1UserInfo[2]) + penaltyPeriodBlocks - 10
    );

    expect(await dividend.isUserInPenaltyPeriod(holder1.address), true);

    await fastForwardBlock((await ethers.provider.getBlockNumber()) + 10);

    expect(await dividend.isUserInPenaltyPeriod(holder1.address), false);
  });

  it("should get 100% amount if someone withdraw after penalty period", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const penaltyPeriodBlocks = 100;

    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    // update rewardPerBlock to 0
    await dividend.updateRewardPerBlock("0");

    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    const rewardAmount = await DoppleToken.balanceOf(dividend.address);
    expect(rewardAmount).to.equal(fiveHundredThousand);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);
    const holder1UserInfo = await dividend.userInfo(holder1.address);
    // holder 2 put deposit stake token to dividend's contract
    await dividend.connect(holder2).deposit(one);
    expect(await dividend.isUserInPenaltyPeriod(holder1.address), true);

    await fastForwardBlock(penaltyPeriodBlocks);

    expect(await dividend.isUserInPenaltyPeriod(holder1.address), false);
    const beforeHolder1Balance = await DoppleToken.balanceOf(holder1.address);
    const before = ethers.utils.formatEther(beforeHolder1Balance);

    let rewardHolder1 = await dividend.pendingReward(holder1.address);
    rewardHolder1 = ethers.utils.formatEther(rewardHolder1.toString());

    await dividend.connect(holder1).withdraw(one);
    const holder1Balance = await DoppleToken.balanceOf(holder1.address);
    const after = ethers.utils.formatEther(holder1Balance);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    expect(before).to.equal("999999.0");
    // 999999.0 + 1
    expect(after).to.equal("1000000.0");
  });

  it("should not update depositReward if user deposit", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const penaltyPeriodBlocks = 100;

    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    // // update rewardPerBlock to 0
    // await dividend.updateRewardPerBlock("0");

    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    const beforeRewardAmount = await DoppleToken.balanceOf(dividend.address);
    expect(beforeRewardAmount).to.equal(fiveHundredThousand);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);
    const holder1UserInfo = await dividend.userInfo(holder1.address);
    // holder 2 put deposit stake token to dividend's contract
    await dividend.connect(holder2).deposit(one);
    expect(await dividend.isUserInPenaltyPeriod(holder1.address), true);

    await fastForwardBlock(penaltyPeriodBlocks);

    const afterRewardAmount = await DoppleToken.balanceOf(dividend.address);

    const stakingCount = await dividend.stakingCount();

    const remainingRewardInDividend = afterRewardAmount.sub(stakingCount);
    expect(remainingRewardInDividend).to.equal(fiveHundredThousand);
  });

  it("should get only 99% amount if emergency withdraw", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const penaltyPeriodBlocks = 99;

    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);
    let beforeEmergencyWithdraw = await DoppleToken.balanceOf(holder1.address);
    beforeEmergencyWithdraw = ethers.utils.formatEther(beforeEmergencyWithdraw);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    await dividend.connect(holder1).emergencyWithdraw();

    let afterHolder1Balance = await DoppleToken.balanceOf(holder1.address);
    afterHolder1Balance = ethers.utils.formatEther(afterHolder1Balance);

    expect(beforeEmergencyWithdraw).to.equal("1000000.0");
    expect(afterHolder1Balance).to.equal("999999.99");
  });

  it("should revert if adminWithdraw more than remaining reward", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const penaltyPeriodBlocks = 99;

    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    const beforeOwnerBalance = await DoppleToken.balanceOf(dividend.address);
    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    const dividendBalance = await DoppleToken.balanceOf(dividend.address);

    try {
      await dividend.connect(owner).adminWithdraw(dividendBalance.toString());
    } catch (err) {
      expect(err.message).to.have.string(
        "DiamondHandInitializable::adminWithdraw: _amount should be less than or equal the total remaining reward"
      );
    }
  });

  it("adminWithdraw reward should not more than current remaining reward", async () => {
    const one = ethers.utils.parseEther("1");
    const three = ethers.utils.parseEther("3");
    const fiveHundredThousand = ethers.utils.parseEther("500000");
    const penaltyPeriodBlocks = 99;

    const [owner, holder1, holder2] = await ethers.getSigners();
    const DoppleToken = await ethers.getContract("DoppleToken");

    const beforeOwnerBalance = await DoppleToken.balanceOf(owner.address);

    // owner depositReward to dividend's contract
    await dividend.connect(owner).depositReward(fiveHundredThousand);

    // holder 1 put deposit stake token to dividend's contract
    await dividend.connect(holder1).deposit(one);

    // const dividendBalance = await DoppleToken.balanceOf(dividend.address);
    const remainingReward = await dividend.getTotalRemainingReward();
    await dividend.connect(owner).adminWithdraw(remainingReward.toString());

    const afterOwnerBalance = await DoppleToken.balanceOf(owner.address);

    expect(beforeOwnerBalance).to.equal(afterOwnerBalance);
  });
});
