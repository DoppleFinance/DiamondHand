module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const _startReleaseBlock = '1000';
    const _endReleaseBlock = '2000';

    await deploy('DoppleToken', {
        from: deployer,
        args: [_startReleaseBlock, _endReleaseBlock],
        log: true,
    });
};

module.exports.tags = ['DoppleToken'];