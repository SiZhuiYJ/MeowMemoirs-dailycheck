/**
 * @file 课程相关类型定义
 * @description 包含课程、课程数据传输对象（DTO）以及事件的接口定义
 */

/**
 * 课程前端展示对象
 */
export interface Class {
    /** 课程 ID */
    id: number;
    /** 课程名称 */
    name: string;
    /** 上课地点 */
    location: string;
    /** 星期几 (1-7) */
    dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    /** 上课周数数组 */
    week: number[];
    /** 上课节次数组 */
    number: number[];
    /** 任课教师 */
    teacher: string;
    /** 展示颜色 */
    color: string;
    /** 备注信息 */
    remark?: string;
}

/**
 * 课程数据库存储对象 (Data Transfer Object)
 */
export interface ClassDto {
    /** 课程 ID */
    id: number;
    /** 用户 ID */
    userId: number;
    /** 课程名称 */
    className: string;
    /** 上课地点 */
    location: string;
    /** 星期几 (1-7) */
    dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    /** 周数 (字符串格式，如 "1,2,3") */
    weekList: string;
    /** 节次 (字符串格式，如 "1,2") */
    sessionList: string;
    /** 任课教师 */
    teacher: string;
    /** 展示颜色 */
    color: string;
    /** 备注信息 */
    remark?: string;
    /** 是否已删除 (0: 未删除, 1: 已删除) */
    isDeleted: 0 | 1;
    /** 创建时间 */
    createTime: string;
    /** 更新时间 */
    updateTime: string;
}


