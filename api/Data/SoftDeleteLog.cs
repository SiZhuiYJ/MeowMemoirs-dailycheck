using System;
using System.Collections.Generic;

namespace api.Data;

/// <summary>
/// 伪删除操作日志表
/// </summary>
public partial class SoftDeleteLog
{
    /// <summary>
    /// 主键ID
    /// </summary>
    public ulong Id { get; set; }

    /// <summary>
    /// 伪删除记录所属表名
    /// </summary>
    public string TableName { get; set; } = null!;

    /// <summary>
    /// 被伪删除记录的主键ID
    /// </summary>
    public ulong RecordId { get; set; }

    /// <summary>
    /// 执行伪删除操作的用户ID
    /// </summary>
    public ulong? DeleterUserId { get; set; }

    /// <summary>
    /// 伪删除原因
    /// </summary>
    public string? Reason { get; set; }

    /// <summary>
    /// 伪删除时间
    /// </summary>
    public DateTime DeletedAt { get; set; }

    /// <summary>
    /// 扩展信息(JSON)，如数据快照等
    /// </summary>
    public string? Extra { get; set; }

    public virtual User? DeleterUser { get; set; }
}
