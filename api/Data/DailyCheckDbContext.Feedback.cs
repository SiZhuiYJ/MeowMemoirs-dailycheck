using Microsoft.EntityFrameworkCore;

namespace api.Data;

/// <summary>
/// 意见反馈实体的映射（Feedback）。
///
/// 和 Schedule 一样放在 partial 文件里，而不是改 DailyCheckDbContext.cs 主文件：
/// 主文件由 EF scaffold 生成，重新 scaffold 会被覆盖。
///
/// <para>
/// 注意：C# 的 partial 方法只允许**一个**实现声明，而 <c>OnModelCreatingPartial</c>
/// 的实现已被 <c>DailyCheckDbContext.Schedule.cs</c> 占用。所以这里把反馈映射写成
/// 普通方法 <see cref="ConfigureFeedbackModel"/>，由 Schedule partial 里的
/// OnModelCreatingPartial 统一调用，各业务模块的映射仍各自独立成文件、互不覆盖。
/// </para>
/// </summary>
public partial class DailyCheckDbContext
{
    /// <summary>用户意见反馈</summary>
    public virtual DbSet<Feedback> Feedbacks { get; set; }

    /// <summary>
    /// 挂载反馈表映射（由 <c>DailyCheckDbContext.Schedule.cs</c> 的 OnModelCreatingPartial 调用）。
    /// </summary>
    /// <param name="modelBuilder">EF 模型构建器。</param>
    void ConfigureFeedbackModel(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Feedback>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("feedbacks", tb => tb.HasComment("用户意见反馈"))
                .UseCollation("utf8mb4_unicode_ci");

            // 「我的反馈」按 user_id 过滤 + created_at 倒序；管理员列表按 status 筛选 + created_at 倒序，
            // 两个复合索引分别覆盖这两类高频查询，避免反馈量上来后全表排序。
            entity.HasIndex(e => new { e.UserId, e.CreatedAt }, "idx_feedbacks_user_created");
            entity.HasIndex(e => new { e.Status, e.CreatedAt }, "idx_feedbacks_status_created");

            entity.Property(e => e.Id).HasComment("反馈ID").HasColumnName("id");
            entity.Property(e => e.UserId).HasComment("提交用户ID").HasColumnName("user_id");
            entity.Property(e => e.Content)
                .HasMaxLength(2000)
                .HasComment("反馈内容")
                .HasColumnName("content");
            entity.Property(e => e.Contact)
                .HasMaxLength(128)
                .HasComment("联系方式（可选）")
                .HasColumnName("contact");
            entity.Property(e => e.App)
                .HasDefaultValueSql("'web'")
                .HasComment("来源端：web 网页，mp 小程序")
                .HasColumnType("enum('web','mp')")
                .HasColumnName("app");
            entity.Property(e => e.Status)
                .HasDefaultValueSql("'pending'")
                .HasComment("处理状态：pending 待回复，replied 已回复")
                .HasColumnType("enum('pending','replied')")
                .HasColumnName("status");
            entity.Property(e => e.ReplyContent)
                .HasMaxLength(2000)
                .HasComment("管理员回复内容")
                .HasColumnName("reply_content");
            entity.Property(e => e.RepliedByUserId)
                .HasComment("回复管理员ID")
                .HasColumnName("replied_by_user_id");
            entity.Property(e => e.RepliedAt)
                .HasComment("回复时间")
                .HasColumnType("datetime")
                .HasColumnName("replied_at");
            entity.Property(e => e.IsDeleted)
                .HasComment("0-正常 1-删除")
                .HasColumnName("is_deleted");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("提交时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
        });
    }
}
