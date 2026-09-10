// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

/// @title            Decompiled Contract
/// @author           Jonathan Becker <jonathan@jbecker.dev>
/// @custom:version   heimdall-rs v0.9.2
///
/// @notice           This contract was decompiled using the heimdall-rs decompiler.
///                     It was generated directly by tracing the EVM opcodes from this contract.
///                     As a result, it may not compile or even be valid solidity code.
///                     Despite this, it should be obvious what each function does. Overall
///                     logic should have been preserved throughout decompiling.
///
/// @custom:github    You can find the open-source decompiler here:
///                       https://heimdall.rs

contract DecompiledContract {
    uint256 public constant unresolved_313ce567 = 18;
    uint256 public constant unresolved_c969943e = 1000000000000000000000000000;
    
    string public unresolved_06fdde03; // storage slot: 0x00
    string public unresolved_95d89b41; // storage slot: 0x01
    bytes public unresolved_03ee438c; // storage slot: 0x02
    address public unresolved_02669b52; // storage slot: 0x03
    bytes32 store_e; // storage slot: 0x04
    bytes32 store_h; // storage slot: 0x07
    uint8 store_g; // storage slot: 0x07
    bytes32 store_i; // storage slot: var_a
    
    mapping(address => uint256) public unresolved_70a08231; // storage slot: 0x05
    mapping(address => mapping(address => uint256)) public unresolved_dd62ed3e; // storage slot: 0x06
    
    error CustomError_00000000();
    event Event_8c5be1e5();
    event Event_ddf252ad();
    
    /// @custom:selector    0x095ea7b3
    /// @custom:signature   Unresolved_095ea7b3(address arg0, uint256 arg1) public payable returns (uint256)
    /// @param              arg0 ["address", "uint160", "bytes20", "int160"]
    /// @param              arg1 ["uint256", "bytes32", "int256"]
    function Unresolved_095ea7b3(address arg0, uint256 arg1) public payable returns (uint256) {
        require(0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc + msg.data.length >= 0x40);
        require(!(arg0 - arg0));
        unresolved_dd62ed3e[msg.sender][arg0] = arg1;
        emit Event_8c5be1e5(msg.sender, arg0, arg1);
        return 0x01;
    }
    
    /// @custom:selector    0x18160ddd
    /// @custom:signature   Unresolved_18160ddd() public view returns (uint256)
    function Unresolved_18160ddd() public view returns (uint256) {
        require(0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc + msg.data.length >= 0);
        return store_e;
    }
    
    /// @custom:selector    0x23b872dd
    /// @custom:signature   Unresolved_23b872dd(address arg0, address arg1, uint256 arg2) public payable returns (uint256)
    /// @param              arg0 ["address", "uint160", "bytes20", "int160"]
    /// @param              arg1 ["address", "uint160", "bytes20", "int160"]
    /// @param              arg2 ["uint256", "bytes32", "int256"]
    function Unresolved_23b872dd(address arg0, address arg1, uint256 arg2) public payable returns (uint256) {
        require(0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc + msg.data.length >= 0x60);
        require(!(arg0 - arg0));
        require(!(arg1 - arg1));
        if (unresolved_dd62ed3e[arg0][msg.sender] != type(uint256).max) {
            (bool success, bytes memory ret0) = address(unresolved_02669b52).Unresolved_67ead7a3(msg.sender); // staticcall
            require(success);
            if (!(var_e + 0x20 > 0xffffffffffffffff | var_e + 0x20 < var_e)) {
                uint256 var_e = var_e + 0x20;
                require(var_e + 0x20 - var_e >= 0x20);
                require(!(var_g - var_g));
            }
        } else {
            if (unresolved_dd62ed3e[arg0][msg.sender] != type(uint256).max) {
                require(unresolved_dd62ed3e[arg0][msg.sender] >= arg2, CustomError_13be252b());
            } else {
                require(arg1, CustomError_d92e233d());
                require(unresolved_70a08231[arg0] >= arg2, CustomError_f4d678b8());
                unresolved_70a08231[arg0] -= arg2;
                unresolved_70a08231[arg1] += arg2;
                emit Event_ddf252ad(arg0, arg1, arg2);
                return 0x01;
            }
        }
    }
    
    /// @custom:selector    0x5c6d8da1
    /// @custom:signature   Unresolved_5c6d8da1(uint256 arg0, uint256 arg1, uint256 arg2, address arg3) public payable
    /// @param              arg0 ["uint256", "bytes32", "int256"]
    /// @param              arg1 ["uint256", "bytes32", "int256"]
    /// @param              arg2 ["uint256", "bytes32", "int256"]
    /// @param              arg3 ["address", "uint160", "bytes20", "int160"]
    function Unresolved_5c6d8da1(uint256 arg0, uint256 arg1, uint256 arg2, address arg3) public payable {
        require(0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc + msg.data.length >= 0x80);
        require(arg0 <= 0xffffffffffffffff);
        require(msg.data[0x04 + arg0] <= 0xffffffffffffffff);
        require(arg1 <= 0xffffffffffffffff);
        require(msg.data[0x04 + arg1] <= 0xffffffffffffffff);
        require(arg2 <= 0xffffffffffffffff);
        require(msg.data[0x04 + arg2] <= 0xffffffffffffffff);
        require(!(arg3 - arg3));
        require(!store_g, CustomError_0dc149f0());
        require(arg3, CustomError_d92e233d());
        store_h = 0x01 | 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00 & store_h;
        if (msg.data[0x04 + arg0] <= 0xffffffffffffffff && (unresolved_06fdde03 >> 0x01 < 0x20 != (unresolved_06fdde03 & 0x01) && 0x01 == (msg.data[0x04 + arg0] > 0x1f))) {
            store_i = ~(type(uint256).max >> (0xf8 & msg.data[0x04 + arg0] << 0x03)) & msg.data[0x04 + arg0 + 0x20];
            unresolved_06fdde03 = (msg.data[0x04 + arg0] << 0x01) + 0x01;
        }
    }
    
    /// @custom:selector    0xa9059cbb
    /// @custom:signature   Unresolved_a9059cbb(address arg0, uint256 arg1) public payable returns (uint256)
    /// @param              arg0 ["address", "uint160", "bytes20", "int160"]
    /// @param              arg1 ["uint256", "bytes32", "int256"]
    function Unresolved_a9059cbb(address arg0, uint256 arg1) public payable returns (uint256) {
        require(0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc + msg.data.length >= 0x40);
        require(!(arg0 - arg0));
        require(arg0, CustomError_d92e233d());
        require(unresolved_70a08231[msg.sender] >= arg1, CustomError_f4d678b8());
        unresolved_70a08231[msg.sender] -= arg1;
        unresolved_70a08231[arg0] += arg1;
        emit Event_ddf252ad(msg.sender, arg0, arg1);
        return 0x01;
    }
}