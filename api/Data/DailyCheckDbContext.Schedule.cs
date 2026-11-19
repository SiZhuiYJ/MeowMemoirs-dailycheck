using Microsoft.EntityFrameworkCore;

namespace api.Data;

/// <summary>
/// 课表相关实体的映射（Schedule / Course / CourseTime）。
///
/// 单独放在 partial 文件里而不是改 DailyCheckDbContext.cs 主文件：
/// 该文件是由 EF scaffold 生成的大文件，重新 scaffold 时会被覆盖，
/// 这里通过 OnModelCreatingPartial 挂载，迁移不会丢。
/// </summary>
public partial class DailyCheckDbContext
{
    public virtual DbSet<Schedule> Schedules { get; set; }

    public virtual DbSet<Course> Courses { get; set; }

    public virtual DbSet<CourseTime> CourseTimes { get; set; }

    partial void OnModelCreatingPartial(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Schedule>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("schedules", tb => tb.HasComment("课表"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.UserId, "idx_schedules_user");

            entity.Property(e => e.Id).HasComment("主键ID").HasColumnName("id");
            entity.Property(e => e.UserId).HasComment("所属用户ID").HasColumnName("user_id");
            entity.Property(e => e.ScheduleName)
                .HasMaxLength(100)
                .HasComment("课表名称")
                .HasColumnName("schedule_name");
            entity.Property(e => e.StartTime)
                .HasComment("开课日期")
                .HasColumnType("date")
                .HasColumnName("start_time");
            entity.Property(e => e.WeekCount)
                .HasDefaultValueSql("'20'")
                .HasComment("学期总周数")
                .HasColumnName("week_count");
            entity.Property(e => e.TimetableJson)
                .HasComment("作息时间表（JSON 数组）")
                .HasColumnType("json")
                .HasColumnName("timetable");
            entity.Property(e => e.Remark)
                .HasComment("备注")
                .HasColumnType("text")
                .HasColumnName("remark");
            entity.Property(e => e.IsDeleted)
                .HasDefaultValueSql("'0'")
                .HasComment("是否伪删除：0正常，1已删除")
                .HasColumnName("is_deleted");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");
        });

        modelBuilder.Entity<Course>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("courses", tb => tb.HasComment("课表下的课程"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.ScheduleId, "idx_courses_schedule");
            entity.HasIndex(e => new { e.ScheduleId, e.IsDeleted }, "idx_courses_schedule_deleted");

            entity.Property(e => e.Id).HasComment("主键ID").HasColumnName("id");
            entity.Property(e => e.ScheduleId).HasComment("所属课表ID").HasColumnName("schedule_id");
            entity.Property(e => e.CourseName)
                .HasMaxLength(100)
                .HasComment("课程名称")
                .HasColumnName("course_name");
            entity.Property(e => e.Color)
                .HasMaxLength(16)
                .HasComment("课程颜色")
                .HasColumnName("color");
            entity.Property(e => e.Remark)
                .HasComment("备注")
                .HasColumnType("text")
                .HasColumnName("remark");
            entity.Property(e => e.IsDeleted)
                .HasDefaultValueSql("'0'")
                .HasComment("是否伪删除：0正常，1已删除")
                .HasColumnName("is_deleted");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Schedule)
                .WithMany(p => p.Courses)
                .HasForeignKey(d => d.ScheduleId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("fk_courses_schedule");
        });

        modelBuilder.Entity<CourseTime>(entity =>
        {
            entity.HasKey(e => e.Id).HasName("PRIMARY");

            entity
                .ToTable("course_times", tb => tb.HasComment("课程时间段"))
                .UseCollation("utf8mb4_unicode_ci");

            entity.HasIndex(e => e.CourseId, "idx_course_times_course");
            entity.HasIndex(e => new { e.CourseId, e.IsDeleted }, "idx_course_times_course_deleted");
            entity.HasIndex(e => e.DayOfWeek, "idx_course_times_day");

            entity.Property(e => e.Id).HasComment("主键ID").HasColumnName("id");
            entity.Property(e => e.CourseId).HasComment("所属课程ID").HasColumnName("course_id");
            entity.Property(e => e.Location)
                .HasMaxLength(255)
                .HasComment("上课地点")
                .HasColumnName("location");
            entity.Property(e => e.Teacher)
                .HasMaxLength(100)
                .HasComment("任课教师")
                .HasColumnName("teacher");
            entity.Property(e => e.WeekListJson)
                .HasComment("周次列表（JSON 数组）")
                .HasColumnType("json")
                .HasColumnName("week_list");
            entity.Property(e => e.SectionListJson)
                .HasComment("节次列表（JSON 数组）")
                .HasColumnType("json")
                .HasColumnName("section_list");
            entity.Property(e => e.DayOfWeek)
                .HasComment("星期几：1-7")
                .HasColumnName("day_of_week");
            entity.Property(e => e.Remark)
                .HasComment("备注")
                .HasColumnType("text")
                .HasColumnName("remark");
            entity.Property(e => e.IsDeleted)
                .HasDefaultValueSql("'0'")
                .HasComment("是否伪删除：0正常，1已删除")
                .HasColumnName("is_deleted");
            entity.Property(e => e.CreatedAt)
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("创建时间")
                .HasColumnType("datetime")
                .HasColumnName("created_at");
            entity.Property(e => e.UpdatedAt)
                .ValueGeneratedOnAddOrUpdate()
                .HasDefaultValueSql("CURRENT_TIMESTAMP")
                .HasComment("更新时间")
                .HasColumnType("datetime")
                .HasColumnName("updated_at");

            entity.HasOne(d => d.Course)
                .WithMany(p => p.CourseTimes)
                .HasForeignKey(d => d.CourseId)
                .OnDelete(DeleteBehavior.ClientSetNull)
                .HasConstraintName("fk_course_times_course");
        });
    }
}
