//! Atomic multi-statement writes through the SQL plugin's own pool (SPEC §9.4).
//!
//! The plugin's `execute` takes a pooled connection per call, so a BEGIN … COMMIT
//! sent from the frontend as separate calls isn't one transaction. This command
//! runs a whole batch on one connection inside a real transaction.

use serde::Deserialize;
use serde_json::Value as JsonValue;
use sqlx::{Sqlite, Transaction};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::backup::DB_URL;

#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<JsonValue>,
}

/// Binds values the same way the plugin's `execute` does, except that integers
/// stay integers.
fn bind<'q>(
    mut query: sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    params: &'q [JsonValue],
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    for value in params {
        query = match value {
            JsonValue::Null => query.bind(None::<String>),
            JsonValue::String(s) => query.bind(s.as_str()),
            JsonValue::Number(n) => match n.as_i64() {
                Some(i) => query.bind(i),
                None => query.bind(n.as_f64()),
            },
            JsonValue::Bool(b) => query.bind(i64::from(*b)),
            other => query.bind(other.to_string()),
        };
    }
    query
}

pub async fn run_batch(
    tx: &mut Transaction<'_, Sqlite>,
    statements: &[Statement],
) -> Result<Vec<u64>, String> {
    let mut affected = Vec::with_capacity(statements.len());
    for (i, st) in statements.iter().enumerate() {
        let result = bind(sqlx::query(&st.sql), &st.params)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("statement {} failed: {e}", i + 1))?;
        affected.push(result.rows_affected());
    }
    Ok(affected)
}

/// Runs `statements` in one transaction. Any failure rolls back all of them.
/// Returns the rows affected by each statement.
#[tauri::command]
pub async fn db_transaction(
    instances: State<'_, DbInstances>,
    statements: Vec<Statement>,
) -> Result<Vec<u64>, String> {
    let instances = instances.0.read().await;
    // Only the plugin's `sqlite` feature is enabled, so this is the only variant.
    let DbPool::Sqlite(pool) = instances.get(DB_URL).ok_or("the database is not open")?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("starting a transaction: {e}"))?;
    let affected = run_batch(&mut tx, &statements).await?;
    tx.commit()
        .await
        .map_err(|e| format!("committing the transaction: {e}"))?;
    Ok(affected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;
    use sqlx::sqlite::SqlitePoolOptions;

    fn st(sql: &str, params: Vec<JsonValue>) -> Statement {
        Statement {
            sql: sql.into(),
            params,
        }
    }

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL, x REAL, s TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn count(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM t")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn commits_all_statements_and_keeps_integer_types() {
        let pool = pool().await;
        let mut tx = pool.begin().await.unwrap();
        let rows = run_batch(
            &mut tx,
            &[
                st(
                    "INSERT INTO t VALUES (?, ?, ?, ?)",
                    vec![1.into(), 1761000000000_i64.into(), 0.5.into(), "a".into()],
                ),
                st(
                    "INSERT INTO t VALUES (?, ?, ?, ?)",
                    vec![2.into(), true.into(), JsonValue::Null, JsonValue::Null],
                ),
            ],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(rows, vec![1, 1]);
        let kind: String = sqlx::query_scalar("SELECT typeof(n) FROM t WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(kind, "integer");
    }

    #[tokio::test]
    async fn a_failing_statement_rolls_back_the_batch() {
        let pool = pool().await;
        let mut tx = pool.begin().await.unwrap();
        let e = run_batch(
            &mut tx,
            &[
                st("INSERT INTO t (id, n) VALUES (1, 1)", vec![]),
                st("INSERT INTO t (id, n) VALUES (2, NULL)", vec![]),
            ],
        )
        .await
        .unwrap_err();
        assert!(e.starts_with("statement 2 failed"), "{e}");
        drop(tx);
        assert_eq!(count(&pool).await, 0);
    }
}
