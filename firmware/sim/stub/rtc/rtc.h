// Même API que rtc/rtc.h du portage fpb ; l'heure est fixée par sim.c.
#pragma once
#include <stdint.h>
#include <stdbool.h>
typedef struct {
    uint8_t  seconds;
    uint8_t  minutes;
    uint8_t  hours;
    uint8_t  day;
    uint8_t  weekday;   // 0 = dimanche
    uint8_t  month;     // 1-12
    uint16_t year;
} rtc_time_t;
bool     rtc_get_time(rtc_time_t *out);
uint32_t rtc_get_seconds(void);
