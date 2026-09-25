//! Per-package call limits and the response cache.
//!
//! Design: `docs/superpowers/specs/2026-08-01-declarative-http-api-design.md` §6.7.
//!
//! Two layers, deliberately: `minIntervalSeconds` stops one endpoint from being
//! polled in a tight loop, and the daily budget stops a package from spreading
//! the same abuse across many endpoints. Neither can be raised by a package —
//! the numbers come from the declaration (capped at validation) and from this
//! module's default.
//!
//! The bookkeeping is a pure state machine so every rule is unit tested without
//! a clock or a network; the executor supplies `now`.

use std::collections::HashMap;

/// Calls one package may make per UTC day unless the user changes it.
pub const DEFAULT_DAILY_BUDGET: u32 = 500;

/// Range the setting is clamped to.
///
/// The floor keeps the limit meaningful (a budget of zero would only look like
/// a broken widget), the ceiling keeps a typo from turning it off entirely.
pub const MIN_DAILY_BUDGET: u32 = 10;
pub const MAX_DAILY_BUDGET: u32 = 10_000;

/// Brings a user-entered budget into range.
pub fn clamp_daily_budget(value: u32) -> u32 {
    value.clamp(MIN_DAILY_BUDGET, MAX_DAILY_BUDGET)
}

/// Why a call was refused before it was sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LimitRejection {
    /// The endpoint's own `minIntervalSeconds` has not elapsed.
    TooSoon { retry_after_secs: u64 },
    /// The package used up its day.
    BudgetExhausted,
}

/// Key of one endpoint of one package.
type EndpointKey = (String, String);

/// Rate/budget bookkeeping plus the response cache, all keyed per package.
#[derive(Debug, Default)]
pub struct LimitState {
    last_call: HashMap<EndpointKey, i64>,
    budget_day: HashMap<String, i64>,
    budget_used: HashMap<String, u32>,
    cache: HashMap<CacheKey, CacheEntry>,
}

/// A cached response belongs to one exact request, not just one endpoint: two
/// different cities must not share a forecast.
type CacheKey = (String, String, String);

#[derive(Debug, Clone)]
struct CacheEntry {
    fetched_at: i64,
    status: u16,
    body: String,
}

/// UTC day number, used to roll the budget over at midnight.
fn day_of(now: i64) -> i64 {
    now.div_euclid(86_400)
}

impl LimitState {
    /// Checks the interval and the budget without consuming anything.
    pub fn check(
        &self,
        ext_id: &str,
        endpoint_id: &str,
        min_interval_secs: Option<u64>,
        daily_budget: u32,
        now: i64,
    ) -> Result<(), LimitRejection> {
        if let Some(interval) = min_interval_secs.filter(|interval| *interval > 0) {
            if let Some(last) = self.last_call.get(&key(ext_id, endpoint_id)) {
                let elapsed = now.saturating_sub(*last);
                if elapsed < interval as i64 {
                    return Err(LimitRejection::TooSoon {
                        retry_after_secs: (interval as i64 - elapsed).max(1) as u64,
                    });
                }
            }
        }

        if self.used_today(ext_id, now) >= daily_budget {
            return Err(LimitRejection::BudgetExhausted);
        }
        Ok(())
    }

    /// Records that a call actually went out.
    ///
    /// Separate from [`check`] on purpose: a cache hit costs nothing and must
    /// not consume budget, otherwise caching would be a punishment.
    pub fn record_call(&mut self, ext_id: &str, endpoint_id: &str, now: i64) {
        self.last_call.insert(key(ext_id, endpoint_id), now);

        let today = day_of(now);
        let day_entry = self.budget_day.entry(ext_id.to_string()).or_insert(today);
        if *day_entry != today {
            *day_entry = today;
            self.budget_used.insert(ext_id.to_string(), 0);
        }
        *self.budget_used.entry(ext_id.to_string()).or_insert(0) += 1;
    }

    /// Calls this package has made in the current UTC day.
    pub fn used_today(&self, ext_id: &str, now: i64) -> u32 {
        match self.budget_day.get(ext_id) {
            Some(day) if *day == day_of(now) => self.budget_used.get(ext_id).copied().unwrap_or(0),
            // A stale day means the counter belongs to yesterday.
            _ => 0,
        }
    }

    /// Cached body for this exact request, if it is still fresh.
    pub fn cached(
        &self,
        ext_id: &str,
        endpoint_id: &str,
        scope: &str,
        ttl_secs: Option<u64>,
        now: i64,
    ) -> Option<(u16, String)> {
        let ttl = ttl_secs.filter(|ttl| *ttl > 0)?;
        let entry = self.cache.get(&cache_key(ext_id, endpoint_id, scope))?;
        if now.saturating_sub(entry.fetched_at) >= ttl as i64 {
            return None;
        }
        Some((entry.status, entry.body.clone()))
    }

    /// Stores a successful response for later reuse.
    pub fn store(
        &mut self,
        ext_id: &str,
        endpoint_id: &str,
        scope: &str,
        status: u16,
        body: &str,
        now: i64,
    ) {
        self.cache.insert(
            cache_key(ext_id, endpoint_id, scope),
            CacheEntry {
                fetched_at: now,
                status,
                body: body.to_string(),
            },
        );
    }

    /// Calls made today, per package — the feedback that makes the budget
    /// setting adjustable with any confidence.
    pub fn usage_today(&self, now: i64) -> Vec<(String, u32)> {
        let today = day_of(now);
        let mut rows: Vec<(String, u32)> = self
            .budget_day
            .iter()
            .filter(|(_, day)| **day == today)
            .map(|(ext_id, _)| {
                (
                    ext_id.clone(),
                    self.budget_used.get(ext_id).copied().unwrap_or(0),
                )
            })
            .filter(|(_, used)| *used > 0)
            .collect();
        rows.sort();
        rows
    }

    /// Moves everything belonging to a package onto its new id (rename).
    ///
    /// Not `forget`: the daily budget is a ceiling, and a package that could
    /// clear its own counters by renaming itself would not have one. The cache
    /// travels for the plainer reason that it is the same widget asking the
    /// same endpoints — dropping it would spend budget re-fetching answers that
    /// are still fresh.
    pub fn rename(&mut self, from: &str, to: &str) {
        if from == to {
            return;
        }
        // The new id starts empty in practice; where it does not, its own
        // counters are the ones that must survive, so moved rows never
        // overwrite an existing entry.
        let calls: Vec<EndpointKey> = self
            .last_call
            .keys()
            .filter(|(id, _)| id == from)
            .cloned()
            .collect();
        for old in calls {
            let Some(at) = self.last_call.remove(&old) else {
                continue;
            };
            self.last_call.entry((to.to_string(), old.1)).or_insert(at);
        }
        let cached: Vec<CacheKey> = self
            .cache
            .keys()
            .filter(|(id, _, _)| id == from)
            .cloned()
            .collect();
        for old in cached {
            let Some(entry) = self.cache.remove(&old) else {
                continue;
            };
            self.cache
                .entry((to.to_string(), old.1, old.2))
                .or_insert(entry);
        }
        if let Some(day) = self.budget_day.remove(from) {
            self.budget_day.entry(to.to_string()).or_insert(day);
        }
        if let Some(used) = self.budget_used.remove(from) {
            self.budget_used.entry(to.to_string()).or_insert(used);
        }
    }

    /// Drops everything belonging to a package (disable / remove).
    pub fn forget(&mut self, ext_id: &str) {
        self.last_call.retain(|(id, _), _| id != ext_id);
        self.cache.retain(|(id, _, _), _| id != ext_id);
        self.budget_day.remove(ext_id);
        self.budget_used.remove(ext_id);
    }
}

fn key(ext_id: &str, endpoint_id: &str) -> EndpointKey {
    (ext_id.to_string(), endpoint_id.to_string())
}

fn cache_key(ext_id: &str, endpoint_id: &str, scope: &str) -> CacheKey {
    (
        ext_id.to_string(),
        endpoint_id.to_string(),
        scope.to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXT: &str = "weather-mini";
    const ENDPOINT: &str = "forecast";

    #[test]
    fn a_first_call_is_always_allowed() {
        let state = LimitState::default();
        assert!(state.check(EXT, ENDPOINT, Some(60), 500, 1_000).is_ok());
    }

    #[test]
    fn the_interval_is_enforced_per_endpoint() {
        let mut state = LimitState::default();
        state.record_call(EXT, ENDPOINT, 1_000);

        assert_eq!(
            state.check(EXT, ENDPOINT, Some(60), 500, 1_030),
            Err(LimitRejection::TooSoon {
                retry_after_secs: 30
            })
        );
        assert!(state.check(EXT, ENDPOINT, Some(60), 500, 1_060).is_ok());
        // A different endpoint of the same package has its own clock.
        assert!(state.check(EXT, "other", Some(60), 500, 1_030).is_ok());
    }

    #[test]
    fn no_declared_interval_means_no_throttle() {
        let mut state = LimitState::default();
        state.record_call(EXT, ENDPOINT, 1_000);
        assert!(state.check(EXT, ENDPOINT, None, 500, 1_000).is_ok());
        assert!(state.check(EXT, ENDPOINT, Some(0), 500, 1_000).is_ok());
    }

    #[test]
    fn the_daily_budget_covers_every_endpoint_together() {
        let mut state = LimitState::default();
        state.record_call(EXT, "a", 1_000);
        state.record_call(EXT, "b", 1_000);
        state.record_call(EXT, "c", 1_000);
        assert_eq!(state.used_today(EXT, 1_000), 3);

        assert_eq!(
            state.check(EXT, "d", None, 3, 1_000),
            Err(LimitRejection::BudgetExhausted)
        );
        assert!(state.check(EXT, "d", None, 4, 1_000).is_ok());
        // Another package is unaffected.
        assert!(state.check("other", "d", None, 1, 1_000).is_ok());
    }

    #[test]
    fn the_budget_rolls_over_at_utc_midnight() {
        let mut state = LimitState::default();
        state.record_call(EXT, ENDPOINT, 1_000);
        assert_eq!(state.used_today(EXT, 1_000), 1);

        let tomorrow = 1_000 + 86_400;
        assert_eq!(state.used_today(EXT, tomorrow), 0);
        assert!(state.check(EXT, ENDPOINT, None, 1, tomorrow).is_ok());

        state.record_call(EXT, ENDPOINT, tomorrow);
        assert_eq!(state.used_today(EXT, tomorrow), 1, "counter restarted");
    }

    /// Caching must not cost budget, otherwise a well-behaved package that
    /// caches would be worse off than one that does not.
    #[test]
    fn a_cache_hit_costs_nothing() {
        let mut state = LimitState::default();
        state.store(EXT, ENDPOINT, "https://x/a", 200, "{}", 1_000);

        assert_eq!(
            state.cached(EXT, ENDPOINT, "https://x/a", Some(600), 1_500),
            Some((200, "{}".to_string()))
        );
        assert_eq!(state.used_today(EXT, 1_500), 0);
    }

    #[test]
    fn the_cache_expires_and_is_per_request() {
        let mut state = LimitState::default();
        state.store(EXT, ENDPOINT, "https://x/berlin", 200, "berlin", 1_000);

        assert!(
            state
                .cached(EXT, ENDPOINT, "https://x/berlin", Some(600), 1_600)
                .is_none(),
            "expired at exactly ttl"
        );
        assert!(
            state
                .cached(EXT, ENDPOINT, "https://x/hamburg", Some(600), 1_100)
                .is_none(),
            "another request is another entry"
        );
        assert!(
            state
                .cached(EXT, ENDPOINT, "https://x/berlin", None, 1_100)
                .is_none(),
            "no declared ttl means no caching"
        );
    }

    #[test]
    fn the_budget_setting_stays_in_range() {
        assert_eq!(clamp_daily_budget(0), MIN_DAILY_BUDGET);
        assert_eq!(clamp_daily_budget(1), MIN_DAILY_BUDGET);
        assert_eq!(clamp_daily_budget(500), 500);
        assert_eq!(clamp_daily_budget(999_999), MAX_DAILY_BUDGET);
    }

    #[test]
    fn usage_reports_today_per_package() {
        let mut state = LimitState::default();
        state.record_call("a", "one", 1_000);
        state.record_call("a", "two", 1_000);
        state.record_call("b", "one", 1_000);

        assert_eq!(
            state.usage_today(1_000),
            vec![("a".to_string(), 2), ("b".to_string(), 1)]
        );
        // Yesterday's counters are not today's usage.
        assert!(state.usage_today(1_000 + 86_400).is_empty());
    }

    /// Renaming a widget is not a way to buy a second daily budget.
    #[test]
    fn renaming_a_package_carries_its_counters_and_cache() {
        let mut state = LimitState::default();
        state.record_call(EXT, ENDPOINT, 1_000);
        state.record_call(EXT, ENDPOINT, 1_000);
        state.store(EXT, ENDPOINT, "https://x/a", 200, "{}", 1_000);
        state.record_call("keep", ENDPOINT, 1_000);

        state.rename(EXT, "renamed");

        assert_eq!(state.used_today("renamed", 1_000), 2);
        assert_eq!(state.used_today(EXT, 1_000), 0);
        assert!(state
            .cached("renamed", ENDPOINT, "https://x/a", Some(600), 1_000)
            .is_some());
        assert_eq!(
            state.check("renamed", ENDPOINT, Some(60), 500, 1_000),
            Err(LimitRejection::TooSoon {
                retry_after_secs: 60
            }),
            "and the interval it is inside travels too"
        );
        assert_eq!(
            state.used_today("keep", 1_000),
            1,
            "other packages untouched"
        );
    }

    #[test]
    fn forgetting_a_package_clears_its_state() {
        let mut state = LimitState::default();
        state.record_call(EXT, ENDPOINT, 1_000);
        state.store(EXT, ENDPOINT, "https://x/a", 200, "{}", 1_000);
        state.record_call("keep", ENDPOINT, 1_000);

        state.forget(EXT);

        assert_eq!(state.used_today(EXT, 1_000), 0);
        assert!(state
            .cached(EXT, ENDPOINT, "https://x/a", Some(600), 1_000)
            .is_none());
        assert!(state.check(EXT, ENDPOINT, Some(60), 500, 1_000).is_ok());
        assert_eq!(
            state.used_today("keep", 1_000),
            1,
            "other packages untouched"
        );
    }
}
