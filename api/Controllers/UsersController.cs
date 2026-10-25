using api.Data;
using api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace api.Controllers;

/// <summary>
/// 用户资料相关接口。
///
/// 目前只提供聊天页「查看主页」所需的最小信息：昵称、账号、头像、
/// 注册时间、好友关系以及是否已有单聊会话。
/// </summary>
[ApiController]
[Route("mm/[controller]")]
[Authorize]
public class UsersController(DailyCheckDbContext db) : ControllerBase
{
    readonly DailyCheckDbContext _db = db;

    /// <summary>
    /// 获取指定用户的主页信息。
    /// 已登录用户可查看任意未注销用户（包括被对方拉黑的情况）；
    /// 不会返回邮箱、密码等敏感字段。
    /// </summary>
    /// <param name="userId">目标用户ID。</param>
    /// <returns>用户主页信息。</returns>
    [HttpGet("{userId:ulong}/profile")]
    public async Task<ActionResult<UserProfileDto>> GetUserProfile(ulong userId)
    {
        var currentUserId = GetUserId();
        var isSelf = currentUserId == userId;
        var now = DateTime.UtcNow;

        // 旧实现是「查用户 + 6 个独立 Any/First」串行 await，打开一次主页要 7 个数据库往返。
        // 这里改成一条带标量子查询的 SQL：一次往返拿全所有关系状态。
        // 被对方拉黑后仍可查看主页，只把状态带回前端用于提示与禁用互动按钮。
        var profile = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId && !u.IsDeleted)
            .Select(u => new
            {
                u.Id,
                u.UserAccount,
                u.NickName,
                u.AvatarKey,
                u.CreatedAt,
                u.Status,
                IsFriend = _db.UserFriendships.Any(f =>
                    f.UserId == currentUserId &&
                    f.FriendUserId == userId &&
                    f.Status == "active"),
                FriendRemark = _db.UserFriendships
                    .Where(f =>
                        f.UserId == currentUserId &&
                        f.FriendUserId == userId &&
                        f.Status == "active")
                    .Select(f => f.FriendRemark)
                    .FirstOrDefault(),
                IsBlocked = _db.UserBlocks.Any(b =>
                    b.UserId == currentUserId &&
                    b.BlockedUserId == userId),
                IsBlockedByTarget = _db.UserBlocks.Any(b =>
                    b.UserId == userId &&
                    b.BlockedUserId == currentUserId),
                DirectConversationId = _db.ChatConversations
                    .Where(c =>
                        c.ConversationType == "direct" &&
                        c.IsActive == true &&
                        c.ChatConversationMembers.Any(m => m.UserId == currentUserId && m.LeftAt == null) &&
                        c.ChatConversationMembers.Any(m => m.UserId == userId && m.LeftAt == null) &&
                        c.ChatConversationMembers.Count(m => m.LeftAt == null) == 2)
                    .OrderByDescending(c => c.LastMessageAt ?? c.UpdatedAt)
                    .Select(c => (ulong?)c.Id)
                    .FirstOrDefault(),
                HasPendingSentRequest = _db.UserFriendRequests.Any(r =>
                    r.RequesterUserId == currentUserId &&
                    r.ReceiverUserId == userId &&
                    r.RequestStatus == "pending" &&
                    (r.ExpireAt == null || r.ExpireAt > now)),
                HasPendingReceivedRequest = _db.UserFriendRequests.Any(r =>
                    r.RequesterUserId == userId &&
                    r.ReceiverUserId == currentUserId &&
                    r.RequestStatus == "pending" &&
                    (r.ExpireAt == null || r.ExpireAt > now))
            })
            .FirstOrDefaultAsync();

        if (profile == null)
            return NotFound(new { message = "User not found" });

        return Ok(new UserProfileDto
        {
            UserId = profile.Id,
            UserAccount = profile.UserAccount,
            NickName = profile.NickName,
            AvatarKey = profile.AvatarKey,
            CreatedAt = profile.CreatedAt,
            IsSelf = isSelf,
            // 自己看自己时，关系状态一律按「无」返回，和旧实现一致。
            IsFriend = !isSelf && profile.IsFriend,
            IsBlocked = !isSelf && profile.IsBlocked,
            IsBlockedByTarget = !isSelf && profile.IsBlockedByTarget,
            FriendRemark = isSelf ? null : profile.FriendRemark,
            DirectConversationId = isSelf ? null : profile.DirectConversationId,
            HasPendingSentRequest = !isSelf && profile.HasPendingSentRequest,
            HasPendingReceivedRequest = !isSelf && profile.HasPendingReceivedRequest,
            Status = profile.Status == true ? "active" : "frozen"
        });
    }

    /// <summary>
    /// 从JWT令牌中提取当前登录用户的ID。
    /// 支持多种Claim类型以确保兼容性。
    /// </summary>
    /// <returns>用户唯一标识（ulong）。</returns>
    ulong GetUserId()
    {
        var candidateTypes = new[] { ClaimTypes.NameIdentifier, "sub", "nameid", "user_id", "id" };

        foreach (var type in candidateTypes)
        {
            var val = User.FindFirstValue(type);
            if (!string.IsNullOrEmpty(val))
            {
                if (ulong.TryParse(val, out var id))
                    return id;

                throw new InvalidOperationException($"Unable to parse user ID from claim '{type}' with value '{val}'");
            }
        }

        throw new InvalidOperationException("User ID claim was not found in the token");
    }
}
