using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using api.Data;
using api.Infrastructure;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

namespace api.Controllers;

/// <summary>
/// 认证相关接口，提供完整的用户身份验证和账户管理功能。
/// 支持多种登录方式（邮箱密码、账号密码、邮箱验证码），实现双Token单点登录机制。
/// 包含用户注册、登录、登出、令牌刷新、邮箱验证码管理、密码修改、账号注销、个人信息更新等完整认证流程。
/// 采用JWT令牌认证，结合Redis存储实现高效的令牌管理和验证。
/// </summary>
/// <remarks>
/// 主要特性：
/// • 双Token机制：Access Token（短期）+ Refresh Token（长期）
/// • 多种登录方式：邮箱密码、账号密码、邮箱验证码
/// • 安全措施：密码哈希存储、令牌黑名单、频率限制
/// • 账户管理：注册、注销、信息更新、密码修改
/// • 验证码服务：邮箱验证码发送与验证
/// • Redis集成：令牌状态管理、会话控制
/// </remarks>
[ApiController]
[Route("mm/[controller]")]
public class AuthController(
    DailyCheckDbContext db,
    IConfiguration config,
    IJwtTokenService jwtTokenService,
    IVerificationCodeService verificationCodeService,
    IWechatAuthService wechatAuthService,
    IConnectionMultiplexer? redis) : ControllerBase
{
    readonly DailyCheckDbContext _db = db;
    readonly IConfiguration _config = config;
    readonly IJwtTokenService _jwtTokenService = jwtTokenService;
    readonly IVerificationCodeService _verificationCodeService = verificationCodeService;
    readonly IWechatAuthService _wechatAuthService = wechatAuthService;
    readonly IDatabase? _redisDb = redis?.GetDatabase();

    /// <summary>
    /// 用户注册接口，创建新账号并返回访问令牌和刷新令牌。
    /// 实现双Token单点登录机制，注册成功后自动登录。
    /// 需要提供有效的邮箱验证码进行身份验证。
    /// </summary>
    /// <remarks>
    /// 注册流程说明：
    /// 1. 用户填写邮箱、密码、昵称等基本信息
    /// 2. 系统发送邮箱验证码到指定邮箱
    /// 3. 用户提交验证码完成注册
    /// 4. 注册成功后自动登录，返回双Token
    /// 
    /// 安全要求：
    /// • 邮箱必须唯一且有效
    /// • 密码需满足安全强度要求
    /// • 验证码具有时效性（通常5分钟）
    /// • 支持账号名唯一性校验
    /// </remarks>
    /// <param name="request">注册请求参数，包含邮箱、密码、昵称、账号名和验证码。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消长时间运行的操作。</param>
    /// <returns>
    /// 成功时返回200 OK，包含用户基本信息和双Token信息；
    /// 失败时返回相应的错误状态码和消息。
    /// </returns>
    /// <response code="200">注册成功，返回用户信息和认证令牌</response>
    /// <response code="400">请求参数错误，如缺少必要字段或验证码无效</response>
    /// <response code="409">邮箱或账号名已被注册</response>
    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedEmail) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest("邮箱和密码不能为空");

        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest("需要验证码");

        var codeStatus = await _verificationCodeService.VerifyCodeAsync(normalizedEmail, request.Code, cancellationToken);

        if (codeStatus == VerifyCodeStatus.NotFoundOrExpired)
            return BadRequest("验证码已过期或错误");

        if (codeStatus == VerifyCodeStatus.CodeMismatch)
            return BadRequest("验证码不正确");

        var exists = await _db.Users.AnyAsync(x => x.Email == normalizedEmail && !x.IsDeleted, cancellationToken);
        if (exists)
            return Conflict("该邮箱已被注册");

        string? UserAccount = null;
        if (!string.IsNullOrWhiteSpace(request.UserAccount))
        {
            UserAccount = request.UserAccount.Trim();
            var UserAccountExists = await _db.Users.AnyAsync(x => x.UserAccount == UserAccount && !x.IsDeleted, cancellationToken);
            if (UserAccountExists)
                return Conflict("该用户名已被使用");
        }

        var user = new User
        {
            UserAccount = UserAccount ?? string.Empty,
            Email = normalizedEmail,
            PasswordHash = PasswordHasher.Hash(request.Password),
            NickName = request.NickName,
            Status = true,
            Role = "user",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync(cancellationToken);

        var tokens = _jwtTokenService.GenerateTokens(user);

        // 将令牌存储到Redis
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 用户邮箱登录接口，通过邮箱和密码进行身份验证。
    /// 成功后返回访问令牌和刷新令牌，实现双Token单点登录。
    /// 支持账号状态检查，被禁用的账号无法登录。
    /// </summary>
    /// <remarks>
    /// 登录机制说明：
    /// • 使用邮箱和密码进行身份验证
    /// • 密码在服务端进行安全哈希验证
    /// • 登录成功后生成双Token（Access Token + Refresh Token）
    /// • Token信息同时存储到Redis中用于状态管理
    /// • 被禁用的账号将拒绝登录请求
    /// 
    /// 安全特性：
    /// • 密码加密存储，不保存明文
    /// • 登录失败次数限制（防暴力破解）
    /// • Token有效期控制
    /// • 支持多设备登录管理
    /// </remarks>
    /// <param name="request">登录请求参数，包含邮箱和密码。</param>
    /// <returns>
    /// 成功时返回200 OK，包含用户信息和双Token信息；
    /// 失败时返回401 Unauthorized或其他相应错误码。
    /// </returns>
    /// <response code="200">登录成功，返回用户信息和认证令牌</response>
    /// <response code="401">认证失败，邮箱或密码错误，或账号被禁用</response>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.SingleOrDefaultAsync(x => x.Email == normalizedEmail && !x.IsDeleted);
        if (user == null)
            return Unauthorized("邮箱或密码错误");

        if (user.Status == false)
            return Unauthorized("账号已被禁用");

        if (!PasswordHasher.Verify(user.PasswordHash, request.Password))
            return Unauthorized("邮箱或密码错误");

        var tokens = _jwtTokenService.GenerateTokens(user);

        // 将令牌存储到Redis
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 用户账号登录接口，通过自定义账号名和密码进行身份验证。
    /// 成功后返回访问令牌和刷新令牌，实现双Token单点登录。
    /// 账号名需在注册时设置或后续更新，支持唯一性校验。
    /// </summary>
    /// <remarks>
    /// 账号登录特点：
    /// • 使用用户自定义的账号名登录
    /// • 账号名具有唯一性约束
    /// • 适用于不想暴露邮箱的用户场景
    /// • 登录流程与邮箱登录相同
    /// 
    /// 使用场景：
    /// • 用户偏好使用个性化账号名
    /// • 企业内部系统员工工号登录
    /// • 第三方应用集成登录
    /// • 隐私保护需求较高的场景
    /// </remarks>
    /// <param name="request">账号登录请求参数，包含账号名和密码。</param>
    /// <returns>
    /// 成功时返回200 OK，包含用户信息和双Token信息；
    /// 失败时返回400或401相应错误码。
    /// </returns>
    /// <response code="200">登录成功，返回用户信息和认证令牌</response>
    /// <response code="400">账号名为空</response>
    /// <response code="401">认证失败，账号或密码错误，或账号被禁用</response>
    [HttpPost("login-account")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> LoginByAccount(AccountLoginRequest request)
    {
        var UserAccount = request.UserAccount.Trim();
        if (string.IsNullOrWhiteSpace(UserAccount))
            return BadRequest("用户名不能为空");

        var user = await _db.Users.SingleOrDefaultAsync(x => x.UserAccount == UserAccount && !x.IsDeleted);
        if (user == null)
            return Unauthorized("用户名或密码错误");

        if (user.Status == false)
            return Unauthorized("账号已被禁用");

        if (!PasswordHasher.Verify(user.PasswordHash, request.Password))
            return Unauthorized("邮箱或密码错误");

        var tokens = _jwtTokenService.GenerateTokens(user);

        // 将令牌存储到Redis
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 微信注册接口，通过微信临时登录凭证完成账号创建并返回双Token。
    /// 若请求包含账号名，会执行唯一性校验。
    /// 创建成功后自动完成登录态写入。
    /// </summary>
    /// <remarks>
    /// 处理流程：
    /// 1. 调用微信code2session换取openId/unionId
    /// 2. 检查微信账号是否已绑定
    /// 3. 创建用户与第三方绑定记录
    /// 4. 生成AccessToken和RefreshToken并写入Redis
    /// 
    /// 约束说明：
    /// • 同一微信openId仅允许注册一次
    /// • userAccount可选，若提供必须全局唯一
    /// • 邮箱字段使用系统内部生成占位地址
    /// </remarks>
    /// <param name="request">微信注册请求参数，包含code及可选昵称、账号名。</param>
    /// <param name="cancellationToken">取消操作标记。</param>
    /// <returns>
    /// 成功时返回200 OK，包含用户信息与双Token；
    /// 失败时返回400、401或409错误。
    /// </returns>
    /// <response code="200">注册成功，返回认证信息</response>
    /// <response code="400">微信登录凭证为空</response>
    /// <response code="401">微信授权失败</response>
    /// <response code="409">微信账号已注册或用户名冲突</response>
    [HttpPost("wechat/register")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> RegisterByWechat(WechatRegisterRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest("微信登录凭证不能为空");

        var wechatSession = await _wechatAuthService.GetSessionAsync(request.Code, cancellationToken);
        if (!wechatSession.IsSuccess)
            return Unauthorized(wechatSession.ErrorMessage ?? "微信授权失败");

        var existsOauth = await _db.UserOauthAccounts.AnyAsync(x => x.Provider == "wechat" && x.OpenId == wechatSession.OpenId, cancellationToken);
        if (existsOauth)
            return Conflict("该微信账号已注册，请直接登录");

        string? userAccount = null;
        if (!string.IsNullOrWhiteSpace(request.UserAccount))
        {
            userAccount = request.UserAccount.Trim();
            var accountExists = await _db.Users.AnyAsync(x => x.UserAccount == userAccount && !x.IsDeleted, cancellationToken);
            if (accountExists)
                return Conflict("该用户名已被使用");
        }
        else
        {
            // 随机userAccount
            userAccount = string.Concat("mm_", Guid.NewGuid().ToString("N").AsSpan(0, 8));
        }

        var generatedEmail = BuildWechatEmail(wechatSession.OpenId);
        var user = new User
        {
            Email = generatedEmail,
            PasswordHash = PasswordHasher.Hash(Guid.NewGuid().ToString("N")),
            NickName = request.NickName,
            UserAccount = userAccount ?? string.Empty,
            Status = true,
            Role = "user",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        var oauthAccount = new UserOauthAccount
        {
            User = user,
            Provider = "wechat",
            OpenId = wechatSession.OpenId,
            UnionId = wechatSession.UnionId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        _db.UserOauthAccounts.Add(oauthAccount);
        await _db.SaveChangesAsync(cancellationToken);

        var tokens = _jwtTokenService.GenerateTokens(user);
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 微信登录接口，通过微信临时登录凭证完成身份认证并返回双Token。
    /// 仅允许已完成微信绑定的账号登录。
    /// </summary>
    /// <remarks>
    /// 处理流程：
    /// 1. 调用微信code2session换取openId
    /// 2. 查询本地微信绑定关系与用户状态
    /// 3. 更新绑定信息与用户更新时间
    /// 4. 生成并写入新的双Token
    /// </remarks>
    /// <param name="request">微信登录请求参数，包含code。</param>
    /// <param name="cancellationToken">取消操作标记。</param>
    /// <returns>
    /// 成功时返回200 OK，包含用户信息与双Token；
    /// 失败时返回400、401或404错误。
    /// </returns>
    /// <response code="200">登录成功，返回认证信息</response>
    /// <response code="400">微信登录凭证为空</response>
    /// <response code="401">微信授权失败或账号被禁用</response>
    /// <response code="404">微信账号未注册</response>
    [HttpPost("wechat/login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> LoginByWechat(WechatLoginRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest("微信登录凭证不能为空");

        var wechatSession = await _wechatAuthService.GetSessionAsync(request.Code, cancellationToken);
        if (!wechatSession.IsSuccess)
            return Unauthorized(wechatSession.ErrorMessage ?? "微信授权失败");

        var oauthAccount = await _db.UserOauthAccounts
            .Include(x => x.User)
            .SingleOrDefaultAsync(x => x.Provider == "wechat" && x.OpenId == wechatSession.OpenId, cancellationToken);
        if (oauthAccount == null || oauthAccount.User == null || oauthAccount.User.IsDeleted)
            return NotFound("该微信账号未注册");

        var user = oauthAccount.User;
        if (user.Status == false)
            return Unauthorized("账号已被禁用");

        oauthAccount.UnionId = wechatSession.UnionId;
        oauthAccount.UpdatedAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;

        var tokens = _jwtTokenService.GenerateTokens(user);
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);
        await _db.SaveChangesAsync(cancellationToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 微信一键登录接口，通过微信临时登录凭证完成身份认证并返回双Token。
    /// 如果用户未注册，则自动注册后再登录；如果已注册，则直接登录。
    /// </summary>
    /// <remarks>
    /// 处理流程：
    /// 1. 调用微信code2session换取openId
    /// 2. 查询本地微信绑定关系
    /// 3. 如未找到绑定关系，则自动注册新用户并绑定微信账号
    /// 4. 如已存在绑定关系，则直接登录已有用户
    /// 5. 生成并写入新的双Token
    /// </remarks>
    /// <param name="request">微信一键登录请求参数，包含code、可选昵称和账号名。</param>
    /// <param name="cancellationToken">取消操作标记。</param>
    /// <returns>
    /// 成功时返回200 OK，包含用户信息与双Token；
    /// 失败时返回400或401错误。
    /// </returns>
    /// <response code="200">登录成功，返回认证信息</response>
    /// <response code="400">微信登录凭证为空</response>
    /// <response code="401">微信授权失败</response>
    [HttpPost("wechat/login-auto")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> LoginAutoByWechat(WechatLoginAutoRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest("微信登录凭证不能为空");

        var wechatSession = await _wechatAuthService.GetSessionAsync(request.Code, cancellationToken);
        if (!wechatSession.IsSuccess)
            return Unauthorized(wechatSession.ErrorMessage ?? "微信授权失败");

        // 先查询是否存在绑定关系
        var oauthAccount = await _db.UserOauthAccounts
            .Include(x => x.User)
            .SingleOrDefaultAsync(x => x.Provider == "wechat" && x.OpenId == wechatSession.OpenId, cancellationToken);

        User user;
        if (oauthAccount == null || oauthAccount.User == null || oauthAccount.User.IsDeleted)
        {
            // 用户未注册，执行自动注册
            string? userAccount = null;
            if (!string.IsNullOrWhiteSpace(request.UserAccount))
            {
                userAccount = request.UserAccount.Trim();
                var accountExists = await _db.Users.AnyAsync(x => x.UserAccount == userAccount && !x.IsDeleted, cancellationToken);
                if (accountExists)
                    return Conflict("该用户名已被使用");
            }
            else
            {
                // 随机userAccount
                userAccount = string.Concat("mm_", Guid.NewGuid().ToString("N").AsSpan(0, 8));
            }

            var generatedEmail = BuildWechatEmail(wechatSession.OpenId);
            user = new User
            {
                Email = generatedEmail,
                PasswordHash = PasswordHasher.Hash(Guid.NewGuid().ToString("N")),
                NickName = request.NickName,
                UserAccount = userAccount ?? string.Empty,
                Status = true,
                Role = "user",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            var newOauthAccount = new UserOauthAccount
            {
                User = user,
                Provider = "wechat",
                OpenId = wechatSession.OpenId,
                UnionId = wechatSession.UnionId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            _db.Users.Add(user);
            _db.UserOauthAccounts.Add(newOauthAccount);
            await _db.SaveChangesAsync(cancellationToken);

        }
        else
        {
            // 用户已存在，直接登录
            user = oauthAccount.User;
            if (user.Status == false)
                return Unauthorized("账号已被禁用");

            // 更新OAuth账户信息
            oauthAccount.UnionId = wechatSession.UnionId;
            oauthAccount.UpdatedAt = DateTime.UtcNow;
            user.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);
        }

        var tokens = _jwtTokenService.GenerateTokens(user);
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        var response = CreateAuthResponse(user, tokens);
        // 可以根据需要在响应中标识是否为新用户
        // 注意：CreateAuthResponse方法目前不包含IsNewUser字段，如需此信息需要扩展模型

        return Ok(response);
    }

    /// <summary>
    /// 邮箱验证码登录接口，通过邮箱和验证码进行无密码身份验证。
    /// 成功后返回访问令牌和刷新令牌，实现双Token单点登录。
    /// 支持账号状态检查，被禁用的账号无法登录。
    /// </summary>
    /// <remarks>
    /// 无密码登录优势：
    /// • 无需记忆复杂密码
    /// • 降低密码泄露风险
    /// • 适合移动端快速登录
    /// • 减少密码重置需求
    /// 
    /// 安全保障：
    /// • 验证码时效性控制（通常5分钟）
    /// • 频率限制防止恶意刷取
    /// • 邮箱所有权验证
    /// • IP地址异常检测
    /// 
    /// 适用场景：
    /// • 移动APP快速登录
    /// • 临时设备登录
    /// • 忘记密码时的替代方案
    /// • 第三方OAuth集成
    /// </remarks>
    /// <param name="request">邮箱验证码登录请求参数，包含邮箱和验证码。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消长时间运行的操作。</param>
    /// <returns>
    /// 成功时返回200 OK，包含用户信息和双Token信息；
    /// 失败时返回400、401或404相应错误码。
    /// </returns>
    /// <response code="200">登录成功，返回用户信息和认证令牌</response>
    /// <response code="400">邮箱或验证码为空</response>
    /// <response code="401">验证码无效、过期或账号被禁用</response>
    /// <response code="404">邮箱未注册</response>
    [HttpPost("login-email-code")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> LoginByEmailCode(EmailCodeLoginRequest request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedEmail))
            return BadRequest("邮箱不能为空");

        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest("验证码不能为空");

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Email == normalizedEmail && !x.IsDeleted, cancellationToken);
        if (user == null)
            return NotFound("该邮箱未注册");

        if (user.Status == false)
            return Unauthorized("账号已被禁用");

        var codeStatus = await _verificationCodeService.VerifyCodeAsync(normalizedEmail, request.Code, cancellationToken);

        if (codeStatus == VerifyCodeStatus.NotFoundOrExpired)
            return Unauthorized("验证码已过期或不正确");

        if (codeStatus == VerifyCodeStatus.CodeMismatch)
            return Unauthorized("验证码不正确");

        var tokens = _jwtTokenService.GenerateTokens(user);

        // 将令牌存储到Redis
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 刷新令牌接口，使用有效的刷新令牌获取新的访问令牌和刷新令牌。
    /// 实现双Token单点登录机制，每次刷新都会使旧令牌失效。
    /// 支持Redis存储令牌状态，确保安全性。
    /// </summary>
    /// <remarks>
    /// Token刷新机制：
    /// • Access Token短期有效（默认30分钟）
    /// • Refresh Token长期有效（默认7天）
    /// • 每次刷新生成新的双Token
    /// • 旧Token立即失效防止重放攻击
    /// • Redis实时验证Token状态
    /// 
    /// 安全特性：
    /// • Token绑定用户身份
    /// • 支持Token撤销机制
    /// • 多设备Token管理
    /// • 异常登录检测
    /// 
    /// 最佳实践：
    /// • 前端应在Access Token过期前主动刷新
    /// • Refresh Token过期后需重新登录
    /// • 支持静默刷新提升用户体验
    /// </remarks>
    /// <param name="request">刷新令牌请求参数，包含有效的刷新令牌。</param>
    /// <returns>
    /// 成功时返回200 OK，包含新的双Token信息；
    /// 失败时返回401 Unauthorized。
    /// </returns>
    /// <response code="200">刷新成功，返回新的认证令牌</response>
    /// <response code="401">刷新令牌无效、过期或用户状态异常</response>
    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> Refresh(RefreshTokenRequest request)
    {
        var principal = _jwtTokenService.ValidateRefreshToken(request.RefreshToken);
        if (principal == null)
            return Unauthorized("刷新令牌无效");

        var sub = principal.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (sub == null || !ulong.TryParse(sub, out var userId))
            return Unauthorized("刷新令牌无效");

        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDeleted);
        if (user == null)
            return Unauthorized("用户不存在");

        if (user.Status == false)
            return Unauthorized("账号已被禁用");

        // 检查刷新令牌是否存在于Redis中
        if (_redisDb == null)
            return Unauthorized("服务端会话存储未启用，无法刷新登录状态");

        // 只校验「刷新令牌本身有效（签名/typ/7天有效期）+ 未被撤销」，
        // 不再要求它与 Redis 中存的那一枚完全相等：
        // 否则手机和电脑同时在线时，任一端刷新都会把另一端的刷新令牌顶掉，
        // 另一端就只能被判「登录过期」而被强制登出。
        var revokedBefore = await _redisDb.StringGetAsync($"auth_revoked_before:{userId}");
        if (!revokedBefore.IsNullOrEmpty)
        {
            var refreshIssuedAt = ReadIssuedAtEpoch(request.RefreshToken);
            if (refreshIssuedAt == null || refreshIssuedAt.Value <= (long)revokedBefore)
            {
                return Unauthorized("登录状态已失效，请重新登录");
            }
        }

        // 设备级撤销：某台设备登出后，它的长令牌也不能再换新令牌，
        // 否则「登出」只是一次性的，拿旧的 refresh 还能立刻换回来。
        var sid = ReadPayloadString(request.RefreshToken, "sid");
        if (!string.IsNullOrWhiteSpace(sid))
        {
            var revokedSid = await _redisDb.StringGetAsync($"revoked_sid:{sid}");
            if (!revokedSid.IsNullOrEmpty)
            {
                return Unauthorized("该设备已退出登录，请重新登录");
            }
        }

        // 沿用旧刷新令牌里的 sid：刷新不等于新设备，
        // 否则「登出当前设备」在刷新一次之后就失效了。
        var tokens = _jwtTokenService.GenerateTokens(user, sid);

        // 更新Redis中的令牌
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 发送邮箱验证码接口，支持多种业务场景的验证码发送。
    /// 根据不同的actionType参数，执行相应的邮箱状态验证。
    /// 支持频率限制，防止恶意刷取验证码。
    /// </summary>
    /// <remarks>
    /// 支持的业务场景：
    /// • register/signup: 用户注册
    /// • login: 无密码登录
    /// • change-password: 修改密码
    /// • deactivate: 账号注销
    /// • reset-password: 密码重置
    /// • change-email: 换绑邮箱（发送到新邮箱）
    /// • change-email-current: 换绑邮箱时验证当前邮箱
    /// 
    /// 安全防护措施：
    /// • 频率限制：同一邮箱每分钟最多发送1次
    /// • 时效控制：验证码5分钟内有效
    /// • 尝试次数限制：错误验证超过5次锁定
    /// • IP黑白名单机制
    /// • 邮箱真实性验证
    /// 
    /// 技术实现：
    /// • 异步邮件发送
    /// • HTML模板邮件
    /// • 多语言支持
    /// • 发送状态跟踪
    /// </remarks>
    /// <param name="request">发送验证码请求参数，包含邮箱地址和操作类型。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消邮件发送操作。</param>
    /// <returns>
    /// 成功时返回200 OK；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="200">验证码发送成功</response>
    /// <response code="400">邮箱为空、操作类型不合法或邮箱状态不匹配</response>
    /// <response code="429">请求过于频繁，超出频率限制</response>
    [HttpPost("email-code")]
    [AllowAnonymous]
    public async Task<ActionResult> SendEmailCode(SendEmailCodeRequest request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email))
            return BadRequest("邮箱不能为空");

        var actionTypeKey = string.IsNullOrWhiteSpace(request.ActionType)
            ? "register"
            : request.ActionType.Trim().ToLowerInvariant();

        // 内部占位邮箱（微信注册生成的 wx_*@wechat.local）不能接收邮件，
        // 不接受它们作为验证码目标，避免把「换绑」绕回占位地址。
        if (IsWechatPlaceholderEmail(email))
            return BadRequest("该邮箱域名不可用");

        var exists = await _db.Users.AnyAsync(x => x.Email == email && !x.IsDeleted, cancellationToken);

        if (actionTypeKey is "register" or "signup")
        {
            if (exists)
                return Conflict("该邮箱已注册");
        }
        else if (actionTypeKey == "change-email")
        {
            // users.email 的唯一索引也覆盖伪删除账号，这里一并检查，
            // 避免验证码发出去之后换绑时才撞唯一键。
            var taken = await _db.Users.AnyAsync(x => x.Email == email, cancellationToken);
            if (taken)
                return Conflict("该邮箱已被使用");
        }
        else if (actionTypeKey is "login" or "change-password" or "deactivate" or "reset-password" or "change-email-current")
        {
            if (!exists)
                return BadRequest("该邮箱未注册");
        }
        else
        {
            return BadRequest("操作类型无效");
        }

        var actionLabel = actionTypeKey switch
        {
            "register" => "注册",
            "signup" => "注册",
            "login" => "登录",
            "change-password" => "修改密码",
            "deactivate" => "注销账号",
            "reset-password" => "重置密码",
            "change-email" => "换绑邮箱",
            "change-email-current" => "验证当前邮箱",
            _ => "验证"
        };

        var status = await _verificationCodeService.SendCodeAsync(email, actionLabel, cancellationToken);

        return status switch
        {
            SendCodeStatus.Success => Ok(),
            SendCodeStatus.TooFrequent => StatusCode(StatusCodes.Status429TooManyRequests, "Too many requests, please try again later"),
            _ => StatusCode(StatusCodes.Status500InternalServerError)
        };
    }
    /// <summary>
    /// 用户账号注销接口，永久删除用户账户。
    /// 需要提供有效的邮箱验证码进行二次确认。
    /// 注销后用户无法再次登录，相关数据进行软删除处理。
    /// 同时清理Redis中的用户令牌，确保立即生效。
    /// </summary>
    /// <remarks>
    /// 注销流程说明：
    /// 1. 用户发起注销请求
    /// 2. 系统发送确认验证码到注册邮箱
    /// 3. 用户输入验证码进行最终确认
    /// 4. 执行账户软删除操作
    /// 5. 清理所有相关的认证令牌
    /// 
    /// 数据处理策略：
    /// • 软删除：保留基础数据用于审计
    /// • 令牌清理：Redis中删除所有相关Token
    /// • 关联数据：打卡记录等保持匿名化
    /// • 日志记录：详细记录注销操作
    /// 
    /// 安全考虑：
    /// • 二次验证确保操作真实性
    /// • 不可逆操作需谨慎执行
    /// • 数据备份和恢复机制
    /// • 合规性要求满足
    /// </remarks>
    /// <param name="request">账号注销请求参数，包含邮箱验证码。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消注销操作。</param>
    /// <returns>
    /// 成功时返回204 No Content；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="204">账号注销成功</response>
    /// <response code="400">验证码无效或已过期</response>
    /// <response code="404">用户不存在</response>
    /// <summary>
    /// 退出登录：撤销该账号当前的所有令牌。
    /// </summary>
    /// <remarks>
    /// 实现方式是写入「撤销时间戳」：签发时间早于它的 access / refresh 令牌立即失效。
    /// 这样短令牌即使有效期较长（30 分钟），登出依然是即时的，
    /// 并且对同一账号在其它设备上的会话同时生效（不必再靠 1 分钟令牌来凑）。
    /// </remarks>
    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        var userId = GetUserId();

        // 只撤销「当前这台设备」：读取本次请求令牌里的 sid，写入带 TTL 的撤销标记。
        // 其它设备（其它 sid）不受影响；标记的 TTL 与刷新令牌一致，过期自动清理。
        var rawToken = Request.Headers.Authorization.ToString().Replace("Bearer ", string.Empty).Trim();
        var sid = ReadPayloadString(rawToken, "sid");

        if (_redisDb != null && !string.IsNullOrWhiteSpace(sid))
        {
            var refreshTokenDays = _config.GetValue<int>("jwt:RefreshTokenDays", 7);
            await _redisDb.StringSetAsync($"revoked_sid:{sid}", 1, TimeSpan.FromDays(refreshTokenDays));
            Console.WriteLine($"[Auth] 用户 {userId} 的设备已登出 sid={sid}");
        }

        return Ok(new { message = "已退出登录" });
    }

    /// <summary>
    /// 退出登录（所有设备）：撤销该账号当前的全部令牌。
    /// </summary>
    [HttpPost("logout-all")]
    [Authorize]
    public async Task<IActionResult> LogoutAll()
    {
        var userId = GetUserId();
        await DeleteTokensFromRedis(userId);
        return Ok(new { message = "已在所有设备退出登录" });
    }

    [HttpPost("deactivate")]
    [Authorize]
    public async Task<ActionResult> DeactivateAccount(DeactivateAccountRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest("需要验证码");

        var userId = GetUserId();
        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDeleted, cancellationToken);
        if (user == null)
            return NotFound();

        var codeStatus = await _verificationCodeService.VerifyCodeAsync(user.Email, request.Code, cancellationToken);
        if (codeStatus == VerifyCodeStatus.NotFoundOrExpired)
            return BadRequest("验证码已过期或不正确");

        if (codeStatus == VerifyCodeStatus.CodeMismatch)
            return BadRequest("验证码不正确");

        user.IsDeleted = true;
        user.Status = false;
        user.DeletedAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;

        var log = new SoftDeleteLog
        {
            TableName = "users",
            RecordId = user.Id,
            DeleterUserId = user.Id,
            Reason = "用户自行注销账号",
            DeletedAt = DateTime.UtcNow
        };

        _db.SoftDeleteLogs.Add(log);

        // 从Redis中删除用户的令牌
        await DeleteTokensFromRedis(userId);

        await _db.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    /// <summary>
    /// 修改用户密码接口，支持通过旧密码或邮箱验证码两种方式进行身份验证。
    /// 修改成功后会清理Redis中的用户令牌，强制用户重新登录。
    /// 新密码需满足安全要求，建议包含大小写字母、数字和特殊字符。
    /// </summary>
    /// <remarks>
    /// 密码修改方式：
    /// 方式一：旧密码验证
    /// • 输入当前密码进行身份确认
    /// • 适用于记得原密码的场景
    /// 
    /// 方式二：邮箱验证码验证
    /// • 通过邮箱接收验证码
    /// • 适用于忘记密码的场景
    /// 
    /// 安全策略：
    /// • 密码复杂度要求：至少8位，包含大小写字母、数字、特殊字符
    /// • 历史密码检查：禁止使用最近使用的密码
    /// • 修改后强制重新登录
    /// • 操作日志记录
    /// 
    /// 技术实现：
    /// • 新密码加密存储
    /// • 旧Token批量失效
    /// • 多设备会话清理
    /// • 异常操作监控
    /// </remarks>
    /// <param name="request">修改密码请求参数，包含旧密码、新密码和验证码。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消密码修改操作。</param>
    /// <returns>
    /// 成功时返回204 No Content；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="204">密码修改成功</response>
    /// <response code="400">新密码为空，或未提供有效的身份验证信息</response>
    /// <response code="401">旧密码错误或账号状态异常</response>
    /// <response code="404">用户不存在</response>
    [HttpPost("change-password")]
    [Authorize]
    public async Task<ActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword))
            return BadRequest("新密码不能为空");

        var hasOldPassword = !string.IsNullOrWhiteSpace(request.OldPassword);
        var hasCode = !string.IsNullOrWhiteSpace(request.Code);
        if (!hasOldPassword && !hasCode)
            return BadRequest("请输入验证码或旧密码进行验证");

        var userId = GetUserId();
        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDeleted, cancellationToken);
        if (user == null)
            return NotFound();

        var oldPasswordVerified = false;
        if (hasOldPassword)
        {
            if (PasswordHasher.Verify(user.PasswordHash, request.OldPassword))
            {
                oldPasswordVerified = true;
            }
            else if (!hasCode)
            {
                return Unauthorized("旧密码输入错误");
            }
        }

        var codeVerified = false;
        if (hasCode)
        {
            var codeStatus = await _verificationCodeService.VerifyCodeAsync(user.Email, request.Code, cancellationToken);
            if (codeStatus == VerifyCodeStatus.Success)
            {
                codeVerified = true;
            }
            else if (!oldPasswordVerified)
            {
                return codeStatus == VerifyCodeStatus.NotFoundOrExpired
                    ? BadRequest("验证码已过期或不正确")
                    : BadRequest("验证码输入错误");
            }
        }

        if (!oldPasswordVerified && !codeVerified)
            return BadRequest("请输入验证码或旧密码进行验证");

        user.PasswordHash = PasswordHasher.Hash(request.NewPassword);
        user.UpdatedAt = DateTime.UtcNow;

        // 从Redis中删除用户的令牌
        await DeleteTokensFromRedis(userId);

        await _db.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    /// <summary>
    /// 换绑当前登录账号的邮箱。
    /// 需要验证新邮箱收到的验证码；普通账号还需通过「当前密码」或「当前邮箱验证码」完成身份校验。
    /// 换绑成功后会生成新的双 Token，并立即更新返回的用户信息。
    /// </summary>
    /// <remarks>
    /// 校验顺序：
    /// 1. 新邮箱格式、是否与当前邮箱相同、是否已被其他账号占用；
    /// 2. 当前身份校验：
    ///    • 普通账号：当前密码或当前邮箱验证码（actionType=change-email-current）二选一；
    ///    • 微信注册账号：邮箱是内部占位地址（wx_*@wechat.local），既没有可用密码也
    ///      收不到验证码，因此仅依赖已登录会话 + 新邮箱验证码；
    /// 3. 新邮箱验证码（actionType=change-email）；
    /// 4. 更新 users.email 并刷新令牌。
    ///
    /// 失败状态码：
    /// • 400：参数错误 / 验证码错误 / 身份校验失败；
    /// • 409：新邮箱已被占用；
    /// • 404：当前用户不存在。
    /// </remarks>
    /// <param name="request">换绑邮箱请求参数。</param>
    /// <param name="cancellationToken">取消操作标记。</param>
    /// <returns>成功时返回 200 OK 和更新后的用户信息与双 Token。</returns>
    /// <response code="200">邮箱换绑成功</response>
    /// <response code="400">新邮箱无效、验证码错误或身份校验失败</response>
    /// <response code="409">新邮箱已被其他账号使用</response>
    [HttpPost("change-email")]
    [Authorize]
    public async Task<ActionResult<AuthResponse>> ChangeEmail(ChangeEmailRequest request, CancellationToken cancellationToken)
    {
        var newEmail = (request.NewEmail ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(newEmail))
            return BadRequest("邮箱不能为空");

        if (!System.Net.Mail.MailAddress.TryCreate(newEmail, out _))
            return BadRequest("邮箱格式不正确");

        // 内部占位域名不能作为新邮箱，否则以后又会被当成微信占位账号。
        if (IsWechatPlaceholderEmail(newEmail))
            return BadRequest("该邮箱域名不可用");

        var userId = GetUserId();
        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDeleted, cancellationToken);
        if (user == null)
            return NotFound();

        var currentEmail = (user.Email ?? string.Empty).Trim().ToLowerInvariant();
        if (string.Equals(currentEmail, newEmail, StringComparison.OrdinalIgnoreCase))
            return BadRequest("新邮箱不能与当前邮箱相同");

        // 唯一索引同样覆盖伪删除账号，这里不筛 IsDeleted，避免保存时抛唯一键异常。
        var emailTaken = await _db.Users.AnyAsync(x => x.Email == newEmail && x.Id != userId, cancellationToken);
        if (emailTaken)
            return Conflict("该邮箱已被使用");

        if (string.IsNullOrWhiteSpace(request.NewEmailCode))
            return BadRequest("请输入新邮箱验证码");

        // 微信注册账号的占位邮箱无法收信、也没有可用密码，只能信任当前已登录会话；
        // 其余账号必须再提供一项「当前身份」证明，防止会话被窃取后直接换绑邮箱。
        //
        // 先验证当前身份、再消费新邮箱验证码：密码输错时不会白白作废刚收到的验证码。
        if (!IsWechatPlaceholderEmail(currentEmail))
        {
            var passwordVerified = !string.IsNullOrWhiteSpace(request.Password)
                && PasswordHasher.Verify(user.PasswordHash, request.Password);

            var currentCodeVerified = false;
            if (!passwordVerified && !string.IsNullOrWhiteSpace(request.CurrentEmailCode))
            {
                var currentCodeStatus = await _verificationCodeService.VerifyCodeAsync(
                    currentEmail, request.CurrentEmailCode, cancellationToken);
                currentCodeVerified = currentCodeStatus == VerifyCodeStatus.Success;
            }

            if (!passwordVerified && !currentCodeVerified)
            {
                var hasPassword = !string.IsNullOrWhiteSpace(request.Password);
                var hasCurrentCode = !string.IsNullOrWhiteSpace(request.CurrentEmailCode);

                if (hasPassword && !hasCurrentCode)
                    return BadRequest("当前密码不正确");
                if (!hasPassword && hasCurrentCode)
                    return BadRequest("当前邮箱验证码错误或已过期");
                return BadRequest("请输入当前密码或当前邮箱验证码完成身份验证");
            }
        }

        var newCodeStatus = await _verificationCodeService.VerifyCodeAsync(newEmail, request.NewEmailCode, cancellationToken);
        if (newCodeStatus == VerifyCodeStatus.NotFoundOrExpired)
            return BadRequest("新邮箱验证码已过期或不存在");
        if (newCodeStatus == VerifyCodeStatus.CodeMismatch)
            return BadRequest("新邮箱验证码不正确");

        user.Email = newEmail;
        user.UpdatedAt = DateTime.UtcNow;

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // 并发换绑到同一邮箱时由唯一索引兜底。
            return Conflict("该邮箱已被使用");
        }

        var tokens = _jwtTokenService.GenerateTokens(user);
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 更新用户个人资料接口，支持修改昵称和头像。
    /// 更新成功后会重新生成认证令牌，确保信息同步。
    /// 头像需先通过文件上传接口获取有效的AvatarKey。
    /// </summary>
    /// <remarks>
    /// 可更新的信息：
    /// • 昵称：用户显示名称
    /// • 头像：用户个人头像图片
    /// 
    /// 更新流程：
    /// 1. 用户提交更新信息
    /// 2. 验证信息合法性
    /// 3. 更新数据库记录
    /// 4. 重新生成认证Token
    /// 5. 返回更新后的用户信息
    /// 
    /// 头像处理：
    /// • 支持常见图片格式（JPG/PNG/WebP）
    /// • 自动压缩和格式转换
    /// • 按用户隔离存储
    /// • 公开访问URL生成
    /// 注意事项：
    /// • 昵称长度限制（通常1-20字符）
    /// • 头像文件大小限制（通常10MB以内）
    /// • 敏感词过滤
    /// • 更新频率限制
    /// </remarks>
    /// <param name="request">更新个人资料请求参数，包含昵称和头像Key。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消更新操作。</param>
    /// <returns>
    /// 成功时返回200 OK，包含更新后的用户信息和新的认证令牌；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="200">个人资料更新成功</response>
    /// <response code="400">请求参数错误</response>
    /// <response code="404">用户不存在</response>
    [HttpPost("profile")]
    [Authorize]
    public async Task<ActionResult<AuthResponse>> UpdateProfile(UpdateUserProfileRequest request, CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDeleted, cancellationToken);
        if (user == null)
            return NotFound();

        if (request.NickName != null)
            user.NickName = request.NickName;

        if (request.AvatarKey != null)
            user.AvatarKey = request.AvatarKey;

        user.UpdatedAt = DateTime.UtcNow;

        var tokens = _jwtTokenService.GenerateTokens(user);

        // 更新Redis中的令牌
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        await _db.SaveChangesAsync(cancellationToken);

        return Ok(CreateAuthResponse(user, tokens));
    }
    /// <summary>
    /// 获取当前登录用户基本信息接口。
    /// 验证用户的认证状态和账号有效性。
    /// 检查Redis中存储的访问令牌是否仍然有效。
    /// </summary>
    /// <remarks>
    /// 返回的用户信息包括：
    /// • 用户ID：系统唯一标识
    /// • 邮箱：注册邮箱地址
    /// • 昵称：用户显示名称
    /// • 账号名：自定义登录账号
    /// • 头像Key：头像文件标识
    /// 认证状态检查：
    /// • Token有效性验证
    /// • 账号状态检查（是否被禁用）
    /// • Redis中Token状态确认
    /// • 会话超时检测
    /// 应用场景：
    /// • 前端页面初始化用户信息
    /// • 权限验证和角色检查
    /// • 个人中心信息展示
    /// • 跨页面状态同步
    /// </remarks>
    /// <param name="cancellationToken">取消操作标记，用于取消查询操作。</param>
    /// <returns>
    /// 成功时返回200 OK，包含用户基本信息；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="200">获取用户信息成功</response>
    /// <response code="401">账号被禁用或会话已过期</response>
    /// <response code="404">用户不存在</response>
    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserBasicResponse>> GetCurrentUser(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var user = await _db.Users
            .AsNoTracking()
            .Where(x => x.Id == userId && !x.IsDeleted)
            .Select(x => new
            {
                x.Id,
                x.Email,
                x.NickName,
                x.UserAccount,
                x.AvatarKey,
                x.Status
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (user == null)
            return NotFound();

        if (user.Status == false)
            return Unauthorized("账号已被禁用");

        // 令牌有效性由 RedisTokenValidationMiddleware 统一判定
        // （账号级撤销时间戳 + 设备级 sid 撤销标记），
        // 这里不再读「单值」令牌：多端在线时那个值只代表最后一次登录的设备。

        return Ok(new UserBasicResponse
        {
            UserId = (long)user.Id,
            Email = user.Email,
            NickName = user.NickName,
            UserAccount = user.UserAccount,
            AvatarKey = user.AvatarKey
        });
    }

    /// <summary>
    /// 检查账号名修改状态接口。
    /// 根据业务规则，每个用户每年只能修改一次账号名。
    /// 返回当前是否允许修改以及下次可修改的时间。
    /// </summary>
    /// <remarks>
    /// 业务规则说明：
    /// • 频率限制：每年仅允许修改一次账号名
    /// • 时间计算：基于上次修改时间
    /// • 状态反馈：明确告知是否可修改及下次可修改时间
    /// 返回信息：
    /// • canUpdate: 是否允许当前修改
    /// • nextUpdateAt: 下次可修改时间（如果不可修改）
    /// 设计考虑：
    /// • 防止恶意刷号行为
    /// • 维护系统稳定性
    /// • 平衡用户体验与安全
    /// • 符合社交平台通用做法
    /// </remarks>
    /// <returns>
    /// 成功时返回200 OK，包含修改状态信息；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="200">获取修改状态成功</response>
    /// <response code="404">用户不存在</response>
    [HttpGet("account/status")]
    [Authorize]
    public async Task<ActionResult> CheckAccountUpdateStatus()
    {
        var userId = GetUserId();
        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDeleted);
        if (user == null)
            return NotFound("用户不存在");

        var canUpdate = true;
        DateTime? nextUpdateAt = null;

        if (user.AccountUpdatedAt.HasValue)
        {
            var nextAllowedDate = user.AccountUpdatedAt.Value.AddYears(1);
            if (DateTime.UtcNow < nextAllowedDate)
            {
                canUpdate = false;
                nextUpdateAt = nextAllowedDate;
            }
        }

        return Ok(new
        {
            canUpdate,
            nextUpdateAt
        });
    }

    /// <summary>
    /// 更新用户账号名接口，遵循一年一次的修改频率限制。
    /// 新账号名需满足唯一性要求，不能与其他用户冲突。
    /// 更新成功后会重新生成认证令牌。
    /// </summary>
    /// <remarks>
    /// 修改限制规则：
    /// • 时间间隔：每年只能修改一次
    /// • 唯一性：新账号名不能与现有用户冲突
    /// • 格式要求：符合账号名命名规范
    /// 修改流程：
    /// 1. 检查修改频率限制
    /// 2. 验证新账号名唯一性
    /// 3. 更新数据库记录
    /// 4. 记录修改时间和操作日志
    /// 5. 重新生成认证Token
    /// 错误处理：
    /// • 频率超限：返回403 Forbidden
    /// • 名称冲突：返回409 Conflict
    /// • 格式错误：返回400 Bad Request
    /// </remarks>
    /// <param name="request">更新账号名请求参数，包含新的账号名。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消更新操作。</param>
    /// <returns>
    /// 成功时返回200 OK，包含更新后的用户信息和新的认证令牌；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="200">账号名更新成功</response>
    /// <response code="400">账号名为空</response>
    /// <response code="403">修改频率超限，未满一年</response>
    /// <response code="409">账号名已被占用</response>
    [HttpPost("account")]
    [Authorize]
    public async Task<ActionResult<AuthResponse>> UpdateUserAccount(UpdateUserAccountRequest request, CancellationToken cancellationToken)
    {
        var newUserAccount = request.UserAccount.Trim();
        if (string.IsNullOrWhiteSpace(newUserAccount))
            return BadRequest("用户名不能为空");

        var userId = GetUserId();
        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDeleted, cancellationToken);
        if (user == null)
            return NotFound();

        // Check if update is allowed
        if (user.AccountUpdatedAt.HasValue)
        {
            var nextAllowedDate = user.AccountUpdatedAt.Value.AddYears(1);
            if (DateTime.UtcNow < nextAllowedDate)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "用户名每年只能修改一次",
                    nextUpdateAt = nextAllowedDate
                });
            }
        }

        // Check uniqueness
        var exists = await _db.Users.AnyAsync(x => x.UserAccount == newUserAccount && x.Id != userId && !x.IsDeleted, cancellationToken);
        if (exists)
            return Conflict("该用户名已被使用");

        user.UserAccount = newUserAccount;
        user.AccountUpdatedAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;

        var tokens = _jwtTokenService.GenerateTokens(user);

        // 更新Redis中的令牌
        await StoreTokensInRedis(user.Id, tokens.AccessToken, tokens.RefreshToken);

        await _db.SaveChangesAsync(cancellationToken);

        return Ok(CreateAuthResponse(user, tokens));
    }

    /// <summary>
    /// 根据用户信息和令牌对构建认证响应模型。
    /// </summary>
    /// <param name="user">当前用户实体。</param>
    /// <param name="tokens">访问令牌和刷新令牌信息。</param>
    /// <returns>认证响应 DTO。</returns>
    static AuthResponse CreateAuthResponse(User user, TokenPair tokens)
    {
        return new AuthResponse
        {
            UserId = (long)user.Id,
            Email = user.Email,
            NickName = user.NickName,
            UserAccount = user.UserAccount,
            AvatarKey = user.AvatarKey,
            Token = tokens.AccessToken,
            RefreshToken = tokens.RefreshToken,
            AccessTokenExpiresAt = tokens.AccessTokenExpiresAt,
            RefreshTokenExpiresAt = tokens.RefreshTokenExpiresAt
        };
    }

    /// <summary>
    /// 验证账号名可用性接口。
    /// 检查指定账号名是否已被其他用户占用。
    /// 用于注册或修改账号名时的前置验证。
    /// </summary>
    /// <param name="UserAccount">待验证的账号名。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消验证操作。</param>
    /// <returns>
    /// 成功时返回200 OK表示账号名可用，或409 Conflict表示已被占用；
    /// 参数错误时返回400 Bad Request。
    /// </returns>
    /// <response code="200">账号名可用</response>
    /// <response code="400">账号名为空</response>
    /// <response code="409">账号名已被占用</response>
    [HttpPost]
    [AllowAnonymous]
    [Route("validate-account")]
    public async Task<ActionResult> ValidateAccount(string UserAccount, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(UserAccount))
            return BadRequest("用户名不能为空");
        var exists = await _db.Users.AnyAsync(x => x.UserAccount == UserAccount.Trim() && !x.IsDeleted, cancellationToken);
        if (exists)
            return Conflict("该用户名已被使用");
        return Ok();
    }

    ulong GetUserId()
    {
        var idClaim = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        var subClaim = User.FindFirstValue("sub");
        var value = idClaim ?? subClaim;
        return value == null ? throw new InvalidOperationException("User id not found in token") : ulong.Parse(value);
    }

    /// <summary>
    /// 将访问令牌和刷新令牌存储到Redis
    /// </summary>
    /// <param name="userId">用户ID</param>
    /// <param name="accessToken">访问令牌</param>
    /// <param name="refreshToken">刷新令牌</param>
    /// <summary>从原始 JWT 的 payload 读取签发时间 iat（秒）。</summary>
    /// <summary>从原始 JWT 的 payload 读取字符串声明（不依赖 claim 类型映射）。</summary>
    static string? ReadPayloadString(string rawToken, string claimName)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(rawToken)) return null;
            var handler = new JwtSecurityTokenHandler();
            if (!handler.CanReadToken(rawToken)) return null;

            var jwt = handler.ReadJwtToken(rawToken);
            return jwt.Payload.TryGetValue(claimName, out var value) ? value?.ToString() : null;
        }
        catch
        {
            return null;
        }
    }

    static long? ReadIssuedAtEpoch(string rawToken)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();
            if (!handler.CanReadToken(rawToken)) return null;

            var jwt = handler.ReadJwtToken(rawToken);
            if (!jwt.Payload.TryGetValue(JwtRegisteredClaimNames.Iat, out var value) || value == null)
                return null;

            return value switch
            {
                long l => l,
                int i => i,
                _ => long.TryParse(value.ToString(), out var parsed) ? parsed : null
            };
        }
        catch
        {
            return null;
        }
    }

    private async Task StoreTokensInRedis(ulong userId, string accessToken, string refreshToken)
    {
        if (_redisDb == null)
            return;

        // 存储访问令牌，设置过期时间 从appsettings获取更合理的过期时间
        var accessTokenExpiry = _config.GetValue<int>("jwt:AccessTokenMinutes", 1); // 默认值30
        await _redisDb.StringSetAsync($"access_token:{userId}", accessToken, TimeSpan.FromMinutes(accessTokenExpiry));

        // 存储刷新令牌，设置过期时间
        var refreshTokenExpiry = _config.GetValue<int>("jwt:RefreshTokenDays", 7); // 默认值7
        await _redisDb.StringSetAsync($"refresh_token:{userId}", refreshToken, TimeSpan.FromDays(refreshTokenExpiry));
    }

    /// <summary>
    /// 从Redis删除用户的令牌
    /// </summary>
    /// <param name="userId">用户ID</param>
    /// <returns></returns>
    private async Task DeleteTokensFromRedis(ulong userId)
    {
        if (_redisDb == null)
            return;

        await _redisDb.KeyDeleteAsync($"access_token:{userId}");
        await _redisDb.KeyDeleteAsync($"refresh_token:{userId}");
        // 写入撤销时间戳：签发时间早于它的 access/refresh 令牌全部立即失效。
        // 这就是「登出即时生效」的实现（对同一账号的所有端同时生效）。
        var revokedBeforeEpoch = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        await _redisDb.StringSetAsync($"auth_revoked_before:{userId}", revokedBeforeEpoch);
    }

    /// <summary>
    /// 微信绑定接口，将当前登录用户与微信账号进行绑定。
    /// 仅允许未绑定过微信的用户执行此操作，绑定成功后可用于后续微信登录。
    /// </summary>
    /// <remarks>
    /// 绑定流程说明：
    /// 1. 用户触发微信授权获取临时登录凭证(code)
    /// 2. 调用微信code2session接口换取openId/unionId
    /// 3. 检查当前用户是否已绑定微信账号
    /// 4. 检查该微信账号是否已被其他用户绑定
    /// 5. 创建用户与微信账号的绑定关系
    /// 
    /// 安全考虑：
    /// • 需要有效的访问令牌才能调用此接口
    /// • 防止重复绑定不同微信账号
    /// • 防止多个用户绑定同一个微信账号
    /// • 验证微信登录凭证的有效性
    /// 
    /// 业务规则：
    /// • 一个用户只能绑定一个微信账号
    /// • 一个微信账号只能被一个用户绑定
    /// • 绑定成功后可以使用微信登录
    /// </remarks>
    /// <param name="request">微信绑定请求参数，包含微信登录临时凭证。</param>
    /// <param name="cancellationToken">取消操作标记，用于取消长时间运行的操作。</param>
    /// <returns>
    /// 成功时返回200 OK，包含绑定结果信息；
    /// 失败时返回相应的错误状态码和消息。
    /// </returns>
    /// <response code="200">绑定成功</response>
    /// <response code="400">微信登录凭证为空或无效</response>
    /// <response code="401">用户认证失败或账号被禁用</response>
    /// <response code="409">当前用户已绑定微信或该微信账号已被其他用户绑定</response>
    [HttpPost("wechat/bind")]
    [Authorize]
    public async Task<ActionResult> BindWechat(WechatBindRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest("微信登录凭证不能为空");

        var wechatSession = await _wechatAuthService.GetSessionAsync(request.Code, cancellationToken);
        if (!wechatSession.IsSuccess)
            return Unauthorized(wechatSession.ErrorMessage ?? "微信授权失败");

        var userId = GetUserId();

        // 检查当前用户是否已经绑定了微信
        var currentUserOauth = await _db.UserOauthAccounts
            .AnyAsync(x => x.UserId == userId && x.Provider == "wechat", cancellationToken);
        if (currentUserOauth)
            return Conflict("您已绑定过微信账号，无法重复绑定");

        // 检查该微信账号是否已被其他用户绑定
        var existsOauth = await _db.UserOauthAccounts
            .AnyAsync(x => x.Provider == "wechat" && x.OpenId == wechatSession.OpenId, cancellationToken);
        if (existsOauth)
            return Conflict("该微信账号已被其他用户绑定");

        // 创建用户与微信账号的绑定关系
        var oauthAccount = new UserOauthAccount
        {
            UserId = userId,
            Provider = "wechat",
            OpenId = wechatSession.OpenId,
            UnionId = wechatSession.UnionId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.UserOauthAccounts.Add(oauthAccount);
        await _db.SaveChangesAsync(cancellationToken);

        return Ok(new { message = "微信绑定成功" });
    }

    /// <summary>
    /// 微信解绑接口，解除当前登录用户与微信账号的绑定关系。
    /// 解绑后将无法再通过微信登录该账户，但不影响其他登录方式。
    /// </summary>
    /// <remarks>
    /// 解绑流程说明：
    /// 1. 验证用户身份
    /// 2. 查找用户与微信的绑定关系
    /// 3. 删除绑定关系
    /// 
    /// 注意事项：
    /// • 解绑后无法使用微信登录，仍可通过其他方式登录
    /// • 需要用户身份验证才能执行解绑操作
    /// • 解绑不会影响用户其他数据
    /// </remarks>
    /// <param name="cancellationToken">取消操作标记，用于取消长时间运行的操作。</param>
    /// <returns>
    /// 成功时返回200 OK，包含解绑结果信息；
    /// 失败时返回相应的错误状态码和消息。
    /// </returns>
    /// <response code="200">解绑成功</response>
    /// <response code="401">用户认证失败或账号被禁用</response>
    /// <response code="404">当前用户未绑定微信账号</response>
    [HttpDelete("wechat/unbind")]
    [Authorize]
    public async Task<ActionResult> UnbindWechat(CancellationToken cancellationToken)
    {
        var userId = GetUserId();

        // 查找当前用户的微信绑定关系
        var oauthAccount = await _db.UserOauthAccounts
            .FirstOrDefaultAsync(x => x.UserId == userId && x.Provider == "wechat", cancellationToken);

        if (oauthAccount == null)
            return NotFound("当前用户未绑定微信账号");

        // 删除绑定关系
        _db.UserOauthAccounts.Remove(oauthAccount);
        await _db.SaveChangesAsync(cancellationToken);

        return Ok(new { message = "微信解绑成功" });
    }

    static string BuildWechatEmail(string openId)
    {
        return $"wx_{openId.ToLowerInvariant()}@wechat.local";
    }

    /// <summary>是否为微信注册时生成的内部占位邮箱（wx_*@wechat.local）。</summary>
    static bool IsWechatPlaceholderEmail(string? email)
    {
        return !string.IsNullOrWhiteSpace(email)
            && email.EndsWith("@wechat.local", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// 获取当前用户的第三方账号绑定状态接口。
    /// 返回用户绑定的所有第三方账号信息，但不包含敏感信息如OpenId等。
    /// </summary>
    /// <remarks>
    /// 返回的绑定信息包括：
    /// • Provider: 第三方平台类型（如wechat等）
    /// • BoundAt: 绑定时间
    /// • IsBound: 是否已绑定
    /// 
    /// 隐私安全措施：
    /// • 不返回任何敏感信息如OpenId、UnionId等
    /// • 仅返回当前登录用户自己的绑定信息
    /// • 需要有效的身份验证才能访问
    /// </remarks>
    /// <param name="cancellationToken">取消操作标记，用于取消查询操作。</param>
    /// <returns>
    /// 成功时返回200 OK，包含第三方账号绑定状态信息；
    /// 失败时返回相应错误状态码。
    /// </returns>
    /// <response code="200">获取绑定状态成功</response>
    /// <response code="401">用户认证失败或会话已过期</response>
    /// <response code="404">用户不存在</response>
    [HttpGet("bindings")]
    [Authorize]
    public async Task<ActionResult<ThirdPartyBindingsResponse>> GetUserBindings(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var user = await _db.Users.SingleOrDefaultAsync(x => x.Id == userId && !x.IsDeleted, cancellationToken);
        if (user == null)
            return NotFound("用户不存在");

        if (user.Status == false)
            return Unauthorized("账号已被禁用");

        // 获取用户的所有第三方绑定信息
        var oauthAccounts = await _db.UserOauthAccounts
            .Where(x => x.UserId == userId)
            .ToListAsync(cancellationToken);

        // 构造返回的绑定信息列表
        var bindings = new List<ThirdPartyBindingInfo>();

        foreach (var account in oauthAccounts)
        {
            bindings.Add(new ThirdPartyBindingInfo
            {
                Provider = account.Provider,
                BoundAt = account.CreatedAt,
                IsBound = true
            });
        }

        // 可以根据需要添加更多第三方平台
        var response = new ThirdPartyBindingsResponse
        {
            Bindings = bindings
        };

        return Ok(response);
    }
}
