-- Optimization candidates for dailycheck.
-- Source schema reviewed: sql/dailycheck_2026-05-18_170653.sql
-- Target: MySQL 8.0.x.
--
-- Run this only after a fresh backup. The script is intentionally conservative:
-- it adds composite indexes used by the current API queries and fixes one
-- MySQL NULL uniqueness edge case in checkins.

-- Preflight: this must return zero rows before the generated unique key can be
-- added. MySQL unique indexes allow multiple NULL values, so the existing
-- ux_checkins_plan_date_slot does not fully protect default-mode checkins where
-- time_slot_id IS NULL.
SELECT
  plan_id,
  check_date,
  COALESCE(time_slot_id, 0) AS normalized_time_slot_id,
  COUNT(*) AS duplicate_count
FROM checkins
GROUP BY plan_id, check_date, COALESCE(time_slot_id, 0)
HAVING COUNT(*) > 1;

DELIMITER $$

DROP PROCEDURE IF EXISTS tmp_dailycheck_assert_no_duplicate_checkins $$
CREATE PROCEDURE tmp_dailycheck_assert_no_duplicate_checkins()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT plan_id, check_date, COALESCE(time_slot_id, 0) AS normalized_time_slot_id
      FROM checkins
      GROUP BY plan_id, check_date, COALESCE(time_slot_id, 0)
      HAVING COUNT(*) > 1
    ) duplicate_checkins
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Duplicate checkins exist for normalized (plan_id, check_date, time_slot_id). Clean them before adding ux_checkins_plan_date_slot_key.';
  END IF;
END $$

DROP PROCEDURE IF EXISTS tmp_dailycheck_add_column_if_missing $$
CREATE PROCEDURE tmp_dailycheck_add_column_if_missing(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND column_name = p_column_name
  ) THEN
    SET @dailycheck_ddl = p_ddl;
    PREPARE dailycheck_stmt FROM @dailycheck_ddl;
    EXECUTE dailycheck_stmt;
    DEALLOCATE PREPARE dailycheck_stmt;
  END IF;
END $$

DROP PROCEDURE IF EXISTS tmp_dailycheck_add_index_if_missing $$
CREATE PROCEDURE tmp_dailycheck_add_index_if_missing(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = p_table_name
      AND index_name = p_index_name
  ) THEN
    SET @dailycheck_ddl = p_ddl;
    PREPARE dailycheck_stmt FROM @dailycheck_ddl;
    EXECUTE dailycheck_stmt;
    DEALLOCATE PREPARE dailycheck_stmt;
  END IF;
END $$

DELIMITER ;

CALL tmp_dailycheck_assert_no_duplicate_checkins();

-- Correctness: enforce one active logical checkin per plan/date/slot, including
-- the no-slot case where time_slot_id is NULL.
CALL tmp_dailycheck_add_column_if_missing(
  'checkins',
  'time_slot_id_key',
  'ALTER TABLE checkins ADD COLUMN time_slot_id_key BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(time_slot_id, 0)) STORED COMMENT ''Normalized time_slot_id for uniqueness'''
);

CALL tmp_dailycheck_add_index_if_missing(
  'checkins',
  'ux_checkins_plan_date_slot_key',
  'ALTER TABLE checkins ADD UNIQUE KEY ux_checkins_plan_date_slot_key (plan_id, check_date, time_slot_id_key)'
);

-- Checkin calendar/detail queries:
-- WHERE plan_id = ? AND is_deleted = 0 AND check_date BETWEEN/=
CALL tmp_dailycheck_add_index_if_missing(
  'checkins',
  'idx_checkins_plan_deleted_date_slot',
  'ALTER TABLE checkins ADD INDEX idx_checkins_plan_deleted_date_slot (plan_id, is_deleted, check_date, time_slot_id)'
);

-- User-owned plan list:
-- WHERE user_id = ? AND is_deleted = 0 ORDER BY start_date
CALL tmp_dailycheck_add_index_if_missing(
  'checkin_plans',
  'idx_plans_user_deleted_start',
  'ALTER TABLE checkin_plans ADD INDEX idx_plans_user_deleted_start (user_id, is_deleted, start_date)'
);

-- Active slots for a plan:
-- WHERE plan_id = ? AND is_active = 1 ORDER BY order_num, start_time
CALL tmp_dailycheck_add_index_if_missing(
  'checkin_plan_time_slots',
  'idx_slots_plan_active_order',
  'ALTER TABLE checkin_plan_time_slots ADD INDEX idx_slots_plan_active_order (plan_id, is_active, order_num, start_time)'
);

-- Read receipt de-duplication:
-- WHERE user_id = ? AND message_id IN (...)
CALL tmp_dailycheck_add_index_if_missing(
  'chat_message_receipts',
  'idx_chat_receipts_user_message',
  'ALTER TABLE chat_message_receipts ADD INDEX idx_chat_receipts_user_message (user_id, message_id)'
);

-- Conversation inbox and member list helpers.
CALL tmp_dailycheck_add_index_if_missing(
  'chat_conversation_members',
  'idx_chat_members_user_left_conversation',
  'ALTER TABLE chat_conversation_members ADD INDEX idx_chat_members_user_left_conversation (user_id, left_at, conversation_id, is_pinned, updated_at)'
);

CALL tmp_dailycheck_add_index_if_missing(
  'chat_conversation_members',
  'idx_chat_members_conversation_left_joined',
  'ALTER TABLE chat_conversation_members ADD INDEX idx_chat_members_conversation_left_joined (conversation_id, left_at, joined_at)'
);

-- Group join request count/expiry checks:
-- WHERE conversation_id = ? AND request_status = 'pending' AND expire_at ...
CALL tmp_dailycheck_add_index_if_missing(
  'chat_group_join_requests',
  'idx_group_join_requests_conversation_status_expire',
  'ALTER TABLE chat_group_join_requests ADD INDEX idx_group_join_requests_conversation_status_expire (conversation_id, request_status, expire_at)'
);

-- Friend list ordering:
-- WHERE user_id = ? AND status = 'active' ORDER BY is_starred DESC, accepted_at DESC, created_at DESC
CALL tmp_dailycheck_add_index_if_missing(
  'user_friendships',
  'idx_friendships_user_status_order',
  'ALTER TABLE user_friendships ADD INDEX idx_friendships_user_status_order (user_id, status, is_starred DESC, accepted_at DESC, created_at DESC)'
);

ANALYZE TABLE
  checkins,
  checkin_plans,
  checkin_plan_time_slots,
  chat_message_receipts,
  chat_conversation_members,
  chat_group_join_requests,
  user_friendships;

DROP PROCEDURE IF EXISTS tmp_dailycheck_assert_no_duplicate_checkins;
DROP PROCEDURE IF EXISTS tmp_dailycheck_add_column_if_missing;
DROP PROCEDURE IF EXISTS tmp_dailycheck_add_index_if_missing;

-- Optional search improvement:
-- Current API code searches nick_name with LIKE '%keyword%', which cannot use a
-- normal BTREE index. For large user tables, consider changing that query to
-- MATCH ... AGAINST and adding a FULLTEXT index, possibly with the ngram parser
-- if Chinese nickname search is required.
