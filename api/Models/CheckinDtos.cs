using System;
using System.Collections.Generic;

namespace api.Models;

/// <summary>
/// 当日打卡请求参数。
/// </summary>
public class DailyCheckinRequest
{
    /// <summary>
    /// 对应的打卡计划 ID。
    /// </summary>
    public long PlanId { get; set; }

    /// <summary>
    /// 打卡图片 URL 列表，可为空。
    /// </summary>
    public List<string>? ImageUrls { get; set; }

    /// <summary>
    /// 打卡备注信息，可为空。
    /// </summary>
    public string? Note { get; set; }

    /// <summary>
    /// 时间段 ID（可选，用于分时段打卡）
    /// </summary>
    public ulong? TimeSlotId { get; set; }
}

/// <summary>
/// 补打卡请求参数。
/// </summary>
public class RetroCheckinRequest
{
    /// <summary>
    /// 对应的打卡计划 ID。
    /// </summary>
    public long PlanId { get; set; }

    /// <summary>
    /// 需要补打卡的日期。
    /// </summary>
    public DateOnly Date { get; set; }

    /// <summary>
    /// 打卡图片 URL 列表，可为空。
    /// </summary>
    public List<string>? ImageUrls { get; set; }

    /// <summary>
    /// 补打卡备注信息，可为空。
    /// </summary>
    public string? Note { get; set; }

    /// <summary>
    /// 时间段 ID（可选，用于分时段打卡）
    /// </summary>
    public ulong? TimeSlotId { get; set; }
}
/// <summary>
/// 时间段打卡详情请求参数。
/// </summary>
public class TimeSlotStatusItem
{
    /// <summary>
    /// 对应的打卡记录 ID。
    /// </summary>
    public long CheckinId { get; set; }

    /// <summary>
    /// 打卡时间段ID。
    /// </summary>
    public ulong? TimeSlotId { get; set; }

    /// <summary>
    /// 时间段打卡状态：1=正常打卡，2=补打卡等。
    /// </summary>
    public sbyte Status { get; set; }
}

/// <summary>
/// 日历打卡状态项。
/// </summary>
public class CalendarStatusItem
{
    /// <summary>
    /// 日期。
    /// </summary>
    public DateOnly Date { get; set; }

    /// <summary>
    /// 打卡模式：0-默认模式，1-时间段打卡模式
    /// </summary>
    public byte CheckinMode { get; set; }

    /// <summary>
    /// 打卡状态：1=正常打卡，2=补打卡等。
    /// </summary>
    public short? Status { get; set; }

    /// <summary>
    /// 时间段打卡详情列表（仅时间段打卡模式会有）
    /// </summary>
    public List<TimeSlotStatusItem>? TimeSlots { get; set; }
}

/// <summary>
/// 某一天的打卡详情返回结果。
/// </summary>
public class CheckinDetailResponse
{
    /// <summary>
    /// 打卡日期。
    /// </summary>
    public DateOnly Date { get; set; }

    /// <summary>
    /// 打卡状态：0错过、1正常打卡、2补打卡。
    /// </summary>
    public sbyte Status { get; set; }

    /// <summary>
    /// 打卡备注信息，可为空。
    /// </summary>
    public string? Note { get; set; }

    /// <summary>
    /// 打卡图片 URL 列表。
    /// </summary>
    public List<string> ImageUrls { get; set; } = new();

    /// <summary>
    /// 关联的时间段ID（如果有）
    /// </summary>
    public ulong? TimeSlotId { get; set; }
}
