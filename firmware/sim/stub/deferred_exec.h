#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
typedef uint8_t deferred_token;
#define INVALID_DEFERRED_TOKEN 0
typedef uint32_t (*deferred_exec_callback)(uint32_t trigger_time, void *cb_arg);
typedef struct {
    deferred_token         token;
    uint32_t               trigger_time;
    deferred_exec_callback callback;
    void                  *cb_arg;
} deferred_executor_t;
deferred_token defer_exec(uint32_t delay_ms, deferred_exec_callback callback, void *cb_arg);
deferred_token defer_exec_advanced(deferred_executor_t *table, size_t table_count, uint32_t delay_ms, deferred_exec_callback callback, void *cb_arg);
bool cancel_deferred_exec_advanced(deferred_executor_t *table, size_t table_count, deferred_token token);
void deferred_exec_advanced_task(deferred_executor_t *table, size_t table_count, uint32_t *last_execution_time);
