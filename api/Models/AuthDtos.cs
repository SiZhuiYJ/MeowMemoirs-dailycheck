
using System;

namespace api.Models;

/// <summary>
/// 用户注册请求参数。
/// </summary>
public class RegisterRequest
{
    /// <summary>
    /// 用户邮箱地址
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 用户密码
    /// </summary>
    public string Password { get; set; } = string.Empty;

    /// <summary>
    /// 用户昵称，可选
    /// </summary>
    public string? NickName { get; set; }

    /// <summary>
    /// 用户账号，可选
    /// </summary>
    public string? UserAccount { get; set; }

    /// <summary>
    /// 邮箱验证码
    /// </summary>
    public string Code { get; set; } = string.Empty;
}

/// <summary>
/// 用户登录请求参数。
/// </summary>
public class LoginRequest
{
    /// <summary>
    /// 用户邮箱地址。
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 登录密码明文，将在服务端进行哈希验证。
    /// </summary>
    public string Password { get; set; } = string.Empty;
}

/// <summary>
/// 账号登录请求参数
/// </summary>
public class AccountLoginRequest
{
    /// <summary>
    /// 用户账号
    /// </summary>
    public string UserAccount { get; set; } = string.Empty;

    /// <summary>
    /// 用户密码
    /// </summary>
    public string Password { get; set; } = string.Empty;
}

/// <summary>
/// 邮箱验证码登录请求参数。
/// </summary>
public class EmailCodeLoginRequest
{
    /// <summary>
    /// 用户邮箱地址。
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 邮箱验证码。
    /// </summary>
    public string Code { get; set; } = string.Empty;
}

/// <summary>
/// 微信登录请求参数
/// </summary>
public class WechatLoginRequest
{
    /// <summary>
    /// 微信登录临时凭证
    /// </summary>
    public string Code { get; set; } = string.Empty;
}

/// <summary>
/// 微信注册请求参数
/// </summary>
public class WechatRegisterRequest
{
    /// <summary>
    /// 微信登录临时凭证
    /// </summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>
    /// 用户昵称，可选
    /// </summary>
    public string? NickName { get; set; }

    /// <summary>
    /// 用户账号，可选
    /// </summary>
    public string? UserAccount { get; set; }
}

/// <summary>
/// 微信一键登录请求参数，包含code、可选昵称和账号名。
/// 如果用户未注册则自动注册，已注册则直接登录。
/// </summary>
public class WechatLoginAutoRequest
{
    /// <summary>
    /// 微信登录临时凭证
    /// </summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>
    /// 用户昵称，可选
    /// </summary>
    public string? NickName { get; set; }

    /// <summary>
    /// 用户账号，可选
    /// </summary>
    public string? UserAccount { get; set; }
}

/// <summary>
/// 认证响应数据，包含用户信息和双 token 信息。
/// </summary>
public class AuthResponse
{
    /// <summary>
    /// 用户ID
    /// </summary>
    public long UserId { get; set; }

    /// <summary>
    /// 用户邮箱
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 用户昵称，可选
    /// </summary>
    public string? NickName { get; set; }

    /// <summary>
    /// 用户账号，可选
    /// </summary>
    public string? UserAccount { get; set; }

    /// <summary>
    /// 头像键，可选
    /// </summary>
    public string? AvatarKey { get; set; }

    /// <summary>
    /// 访问令牌
    /// </summary>
    public string Token { get; set; } = string.Empty;

    /// <summary>
    /// 刷新令牌
    /// </summary>
    public string RefreshToken { get; set; } = string.Empty;

    /// <summary>
    /// 访问令牌过期时间
    /// </summary>
    public DateTime AccessTokenExpiresAt { get; set; }

    /// <summary>
    /// 刷新令牌过期时间
    /// </summary>
    public DateTime RefreshTokenExpiresAt { get; set; }
}

/// <summary>
/// 用户基本信息响应模型
/// </summary>
public class UserBasicResponse
{
    /// <summary>
    /// 用户ID
    /// </summary>
    public long UserId { get; set; }

    /// <summary>
    /// 用户邮箱
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 用户昵称，可选
    /// </summary>
    public string? NickName { get; set; }

    /// <summary>
    /// 用户账号，可选
    /// </summary>
    public string? UserAccount { get; set; }

    /// <summary>
    /// 头像键，可选
    /// </summary>
    public string? AvatarKey { get; set; }
}

/// <summary>
/// 更新用户资料请求参数
/// </summary>
public class UpdateUserProfileRequest
{
    /// <summary>
    /// 新的昵称，可选
    /// </summary>
    public string? NickName { get; set; }

    /// <summary>
    /// 新的头像键，可选
    /// </summary>
    public string? AvatarKey { get; set; }
}

/// <summary>
/// 更新用户账号请求参数。
/// </summary>
public class UpdateUserAccountRequest
{
    /// <summary>
    /// 新的用户账号名。
    /// </summary>
    public string UserAccount { get; set; } = string.Empty;
}

/// <summary>
/// 刷新令牌请求参数。
/// </summary>
public class RefreshTokenRequest
{
    /// <summary>
    /// 长期刷新令牌字符串。
    /// </summary>
    public string RefreshToken { get; set; } = string.Empty;
}

/// <summary>
/// 发送邮箱验证码请求参数。
/// </summary>
public class SendEmailCodeRequest
{
    /// <summary>
    /// 接收验证码的邮箱地址。
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 操作类型，可选
    /// </summary>
    public string? ActionType { get; set; }
}

/// <summary>
/// 校验邮箱验证码请求参数（当前预留，未公开为独立接口）。
/// </summary>
public class VerifyEmailCodeRequest
{
    /// <summary>
    /// 接收验证码的邮箱地址。
    /// </summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>
    /// 用户提交的邮箱验证码。
    /// </summary>
    public string Code { get; set; } = string.Empty;
}

/// <summary>
/// 账号注销请求参数
/// </summary>
public class DeactivateAccountRequest
{
    /// <summary>
    /// 验证码
    /// </summary>
    public string Code { get; set; } = string.Empty;
}

/// <summary>
/// 更改密码请求参数
/// </summary>
public class ChangePasswordRequest
{
    /// <summary>
    /// 旧密码
    /// </summary>
    public string OldPassword { get; set; } = string.Empty;

    /// <summary>
    /// 新密码
    /// </summary>
    public string NewPassword { get; set; } = string.Empty;

    /// <summary>
    /// 验证码
    /// </summary>
    public string Code { get; set; } = string.Empty;
}

/// <summary>
/// 换绑邮箱请求参数。
/// </summary>
public class ChangeEmailRequest
{
    /// <summary>
    /// 需要换绑到的新邮箱地址。
    /// </summary>
    public string NewEmail { get; set; } = string.Empty;

    /// <summary>
    /// 发送到新邮箱的验证码。
    /// </summary>
    public string NewEmailCode { get; set; } = string.Empty;

    /// <summary>
    /// 当前密码，用于身份校验；与 CurrentEmailCode 至少提供一个。
    /// 微信注册账号的邮箱是内部占位地址，可省略。
    /// </summary>
    public string? Password { get; set; }

    /// <summary>
    /// 发送到当前邮箱的验证码，用于身份校验；与 Password 至少提供一个。
    /// 微信注册账号的邮箱是内部占位地址，可省略。
    /// </summary>
    public string? CurrentEmailCode { get; set; }
}

/// <summary>
/// 微信绑定请求参数，用于将当前登录用户与微信账号进行绑定。
/// </summary>
public class WechatBindRequest
{
    /// <summary>
    /// 微信登录临时凭证，由客户端调用微信授权接口获取。
    /// </summary>
    public string Code { get; set; } = string.Empty;
}

/// <summary>
/// 第三方账号绑定信息响应模型，包含平台类型和绑定时间，但不包含敏感信息如OpenId等。
/// </summary>
public class ThirdPartyBindingInfo
{
    /// <summary>
    /// 第三方登录平台类型，例如：wechat、qq、github等。
    /// </summary>
    public string Provider { get; set; } = string.Empty;

    /// <summary>
    /// 绑定时间。
    /// </summary>
    public DateTime BoundAt { get; set; }
    
    /// <summary>
    /// 是否已绑定。
    /// </summary>
    public bool IsBound { get; set; }
}

/// <summary>
/// 用户第三方账号绑定状态响应模型。
/// </summary>
public class ThirdPartyBindingsResponse
{
    /// <summary>
    /// 当前用户绑定的所有第三方账号信息。
    /// </summary>
    public List<ThirdPartyBindingInfo> Bindings { get; set; } = new();
}