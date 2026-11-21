namespace api.Data;

/// <summary>
/// 作息表模板（可复用的一套上课时间，例如「标准 12 节」「夏季作息」）。
/// 导入课表 / 新建课表时可以直接选一套，不用每次重新填时间。
/// </summary>
public partial class TimetableTemplate
{
    /// <summary>主键 ID</summary>
    public ulong Id { get; set; }

    /// <summary>所属用户 ID</summary>
    public ulong UserId { get; set; }

    /// <summary>作息表名称（如：标准作息）</summary>
    public string Name { get; set; } = null!;

    /// <summary>作息时间（JSON 数组字符串，第 1 节开始，如 ["08:00-08:45"]）</summary>
    public string TimesJson { get; set; } = null!;

    /// <summary>是否伪删除：0正常，1已删除</summary>
    public bool IsDeleted { get; set; }

    /// <summary>创建时间</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>更新时间</summary>
    public DateTime UpdatedAt { get; set; }
}
