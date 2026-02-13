// SPDX-License-Identifier: MIT
// ZionDefi Protocol v2.0 — Pure Utility Helpers
// Standalone functions that do not depend on contract state.

use starknet::ContractAddress;

// ============================================================================
// ARRAY HELPERS
// ============================================================================

/// Returns `true` if `item` is present in `span`.
pub fn array_contains(span: Span<ContractAddress>, item: ContractAddress) -> bool {
    let mut i: u32 = 0;
    loop {
        if i >= span.len() {
            break false;
        }
        if *span.at(i) == item {
            break true;
        }
        i += 1;
    }
}

// ============================================================================
// MATH
// ============================================================================

/// Integer exponentiation:  base^exp.
pub fn pow_u256(base: u256, exp: u32) -> u256 {
    let mut result: u256 = 1;
    let mut i: u32 = 0;
    loop {
        if i >= exp {
            break;
        }
        result = result * base;
        i += 1;
    };
    result
}

/// Minimum of two u256 values.
pub fn min_u256(a: u256, b: u256) -> u256 {
    if a < b { a } else { b }
}

/// Maximum of two u256 values.
pub fn max_u256(a: u256, b: u256) -> u256 {
    if a > b { a } else { b }
}

// ============================================================================
// DATE / CALENDAR  (Gregorian — used for recurring-interval calculations)
// ============================================================================

/// Returns `true` when `year` is a Gregorian leap year.
pub fn is_leap_year(year: u64) -> bool {
    (year % 4 == 0) && (year % 100 != 0 || year % 400 == 0)
}

/// Converts a Unix-epoch day number (days since 1970-01-01) to (year, month, day).
/// Algorithm: Howard Hinnant's `civil_from_days` adapted for unsigned arithmetic.
pub fn civil_from_days(z: u64) -> (u64, u64, u64) {
    let z_adj: u64 = z + 719_468;
    let era: u64 = z_adj / 146_097;
    let doe: u64 = z_adj - era * 146_097;
    let yoe: u64 = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y: u64 = yoe + era * 400;
    let doy: u64 = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp: u64 = (5 * doy + 2) / 153;
    let d: u64 = doy - (153 * mp + 2) / 5 + 1;
    let m: u64 = if mp < 10 { mp + 3 } else { mp - 9 };
    let y_final: u64 = if m <= 2 { y + 1 } else { y };
    (y_final, m, d)
}

/// Converts (year, month, day) → Unix-epoch day number.
pub fn days_from_civil(y_in: u64, m: u64, d: u64) -> u64 {
    let y: u64 = if m <= 2 { y_in - 1 } else { y_in };
    let era: u64 = y / 400;
    let yoe: u64 = y - era * 400;
    let mp: u64 = if m > 2 { m - 3 } else { m + 9 };
    let doy: u64 = (153 * mp + 2) / 5 + d - 1;
    let doe: u64 = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Calculates the recurring-payment interval accounting for a Feb-29 crossing.
pub fn calculate_recurring_interval(last_ts: u64, now_ts: u64) -> u64 {
    let seconds_per_day: u64 = 86_400;
    let base_interval: u64 = 2_592_000; // 30 days

    let last_day = last_ts / seconds_per_day;
    let now_day = now_ts / seconds_per_day;
    if now_day <= last_day {
        return base_interval;
    }

    let (y_last, _, _) = civil_from_days(last_day);
    let (y_now, _, _) = civil_from_days(now_day);

    let mut y = y_last;
    loop {
        if y > y_now {
            break base_interval;
        }
        if is_leap_year(y) {
            let feb29_days = days_from_civil(y, 2, 29);
            let feb29_ts = feb29_days * seconds_per_day;
            if feb29_ts > last_ts && feb29_ts <= now_ts {
                break base_interval + seconds_per_day;
            }
        }
        y += 1;
    }
}
