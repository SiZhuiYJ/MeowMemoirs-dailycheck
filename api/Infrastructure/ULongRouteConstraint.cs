using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace api.Infrastructure;

/// <summary>
/// 支持在路由模板中使用 <c>{id:ulong}</c> 约束。
/// </summary>
public sealed class ULongRouteConstraint : IRouteConstraint
{
    public bool Match(
        HttpContext? httpContext,
        IRouter? route,
        string routeKey,
        RouteValueDictionary values,
        RouteDirection routeDirection)
    {
        if (!values.TryGetValue(routeKey, out var raw) || raw is null)
            return false;

        return ulong.TryParse(raw.ToString(), out _);
    }
}
