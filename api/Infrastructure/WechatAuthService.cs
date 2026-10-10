using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace api.Infrastructure;

public class WechatOptions
{
    public string AppId { get; set; } = string.Empty;

    public string AppSecret { get; set; } = string.Empty;

    public string GrantType { get; set; } = "authorization_code";
}

public class WechatSessionResult
{
    public bool IsSuccess { get; set; }

    public string OpenId { get; set; } = string.Empty;

    public string? UnionId { get; set; }

    public string? SessionKey { get; set; }

    public int? ErrorCode { get; set; }

    public string? ErrorMessage { get; set; }
}

public interface IWechatAuthService
{
    Task<WechatSessionResult> GetSessionAsync(string code, CancellationToken cancellationToken);
}

public class WechatAuthService(HttpClient httpClient, IOptions<WechatOptions> options) : IWechatAuthService
{
    readonly HttpClient _httpClient = httpClient;
    readonly WechatOptions _options = options.Value;

    public async Task<WechatSessionResult> GetSessionAsync(string code, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return new WechatSessionResult
            {
                IsSuccess = false,
                ErrorMessage = "微信登录凭证不能为空"
            };
        }

        if (string.IsNullOrWhiteSpace(_options.AppId) || string.IsNullOrWhiteSpace(_options.AppSecret))
        {
            return new WechatSessionResult
            {
                IsSuccess = false,
                ErrorMessage = "微信服务配置缺失"
            };
        }

        var grantType = string.IsNullOrWhiteSpace(_options.GrantType) ? "authorization_code" : _options.GrantType;
        var requestUri = $"sns/jscode2session?appid={Uri.EscapeDataString(_options.AppId)}&secret={Uri.EscapeDataString(_options.AppSecret)}&js_code={Uri.EscapeDataString(code)}&grant_type={Uri.EscapeDataString(grantType)}";
        using var response = await _httpClient.GetAsync(requestUri, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return new WechatSessionResult
            {
                IsSuccess = false,
                ErrorMessage = "微信服务请求失败"
            };
        }

        var payload = await response.Content.ReadFromJsonAsync<WechatCode2SessionResponse>(cancellationToken);
        if (payload == null)
        {
            return new WechatSessionResult
            {
                IsSuccess = false,
                ErrorMessage = "微信服务返回异常"
            };
        }

        if (payload.ErrCode.HasValue && payload.ErrCode.Value != 0)
        {
            return new WechatSessionResult
            {
                IsSuccess = false,
                ErrorCode = payload.ErrCode,
                ErrorMessage = payload.ErrMsg ?? "微信授权失败"
            };
        }

        if (string.IsNullOrWhiteSpace(payload.OpenId))
        {
            return new WechatSessionResult
            {
                IsSuccess = false,
                ErrorMessage = "微信授权未返回用户标识"
            };
        }

        return new WechatSessionResult
        {
            IsSuccess = true,
            OpenId = payload.OpenId,
            UnionId = payload.UnionId,
            SessionKey = payload.SessionKey
        };
    }

    sealed class WechatCode2SessionResponse
    {
        [JsonPropertyName("openid")]
        public string? OpenId { get; set; }

        [JsonPropertyName("session_key")]
        public string? SessionKey { get; set; }

        [JsonPropertyName("unionid")]
        public string? UnionId { get; set; }

        [JsonPropertyName("errcode")]
        public int? ErrCode { get; set; }

        [JsonPropertyName("errmsg")]
        public string? ErrMsg { get; set; }
    }
}
