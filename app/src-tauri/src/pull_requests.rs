use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Command;

/// Стисла read-модель GitHub PR для глобального inbox застосунку. Дані
/// отримуються лише через локально авторизований `gh`, без збереження токенів.
#[derive(serde::Serialize, Clone)]
pub struct PullRequestSummary {
    pub number: i64,
    pub repository: String,
    pub title: String,
    pub url: String,
    pub updated_at: String,
    pub is_draft: bool,
    pub role: String,
    pub category: String,
    pub action: String,
    pub reviewers: Vec<String>,
    pub failed_checks: Vec<String>,
    pub merge_state: String,
}

#[derive(serde::Deserialize)]
struct SearchResponse {
    data: SearchData,
}

#[derive(serde::Deserialize)]
struct SearchData {
    search: SearchResult,
}

#[derive(serde::Deserialize)]
struct SearchResult {
    nodes: Vec<PullRequestNode>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestNode {
    number: i64,
    title: String,
    url: String,
    updated_at: String,
    is_draft: bool,
    review_decision: Option<String>,
    merge_state_status: String,
    repository: Repository,
    review_requests: ReviewRequests,
    status_check_rollup: Option<StatusCheckRollup>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    name_with_owner: String,
}

#[derive(serde::Deserialize, Default)]
struct ReviewRequests {
    nodes: Vec<ReviewRequest>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewRequest {
    requested_reviewer: Option<Reviewer>,
}

#[derive(serde::Deserialize)]
struct Reviewer {
    #[serde(rename = "__typename")]
    typename: String,
    login: Option<String>,
    name: Option<String>,
}

#[derive(serde::Deserialize, Default)]
struct StatusCheckRollup {
    contexts: CheckContexts,
}

#[derive(serde::Deserialize, Default)]
struct CheckContexts {
    nodes: Vec<CheckContext>,
}

#[derive(serde::Deserialize)]
struct CheckContext {
    name: Option<String>,
    context: Option<String>,
    conclusion: Option<String>,
    state: Option<String>,
}

const QUERY: &str = r#"
query PullRequests($search: String!) {
  search(query: $search, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number title url updatedAt isDraft reviewDecision mergeStateStatus
        repository { nameWithOwner }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login }
              ... on Team { name }
            }
          }
        }
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name conclusion status }
              ... on StatusContext { context state }
            }
          }
        }
      }
    }
  }
}
"#;

/// Повертає відкриті PR, де користувач є автором, assignee або запитаним
/// reviewer. Кожна категорія має одну наступну дію, виведену лише з GitHub
/// фактів: review decision, CI та merge state.
#[tauri::command]
pub fn list_pull_requests() -> Result<Vec<PullRequestSummary>, String> {
    let mut entries: HashMap<(String, i64), (PullRequestNode, HashSet<&str>)> = HashMap::new();
    for (search, role) in [
        ("is:pr is:open author:@me", "author"),
        ("is:pr is:open review-requested:@me", "reviewer"),
        ("is:pr is:open assignee:@me", "assignee"),
    ] {
        for pr in search_pull_requests(search)? {
            let key = (pr.repository.name_with_owner.clone(), pr.number);
            let entry = entries.entry(key).or_insert_with(|| (pr, HashSet::new()));
            entry.1.insert(role);
        }
    }

    let mut result: Vec<_> = entries
        .into_values()
        .map(|(pr, roles)| summarize(pr, roles))
        .collect();
    result.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(result)
}

/// Повертає read-only контекст одного PR для LLM-резюме. Аргументи передаються
/// в `Command` окремо, тому назва репозиторію або номер не інтерпретуються shell.
#[tauri::command]
pub fn pull_request_context(repository: String, number: i64) -> Result<serde_json::Value, String> {
    if repository.is_empty() || number <= 0 {
        return Err("invalid pull request reference".to_string());
    }
    let number = number.to_string();
    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            &number,
            "--repo",
            &repository,
            "--json",
            "title,body,url,files,comments,reviews,statusCheckRollup,mergeStateStatus,reviewDecision",
        ])
        .output()
        .map_err(|error| format!("gh: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("GitHub returned invalid PR context: {error}"))
}

fn search_pull_requests(search: &str) -> Result<Vec<PullRequestNode>, String> {
    let output = Command::new("gh")
        .args([
            "api",
            "graphql",
            "-f",
            &format!("query={QUERY}"),
            "-F",
            &format!("search={search}"),
        ])
        .current_dir(Path::new("."))
        .output()
        .map_err(|error| format!("gh: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice::<SearchResponse>(&output.stdout)
        .map(|response| response.data.search.nodes)
        .map_err(|error| format!("GitHub returned invalid PR data: {error}"))
}

fn summarize(pr: PullRequestNode, roles: HashSet<&str>) -> PullRequestSummary {
    let failed_checks: Vec<String> = pr
        .status_check_rollup
        .as_ref()
        .map(|rollup| {
            rollup
                .contexts
                .nodes
                .iter()
                .filter(|check| {
                    check.conclusion.as_deref() == Some("FAILURE")
                        || check.state.as_deref() == Some("FAILURE")
                })
                .filter_map(|check| check.name.clone().or_else(|| check.context.clone()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let reviewers = pr
        .review_requests
        .nodes
        .iter()
        .filter_map(|request| request.requested_reviewer.as_ref())
        .filter_map(|reviewer| match reviewer.typename.as_str() {
            "User" => reviewer.login.clone(),
            "Team" => reviewer.name.as_ref().map(|name| format!("@{name}")),
            _ => None,
        })
        .collect::<Vec<_>>();
    let role = if roles.contains("author") {
        "author"
    } else if roles.contains("reviewer") {
        "reviewer"
    } else {
        "assignee"
    };
    let (category, action) = if roles.contains("author") {
        author_action(&pr, &failed_checks, &reviewers)
    } else if roles.contains("reviewer") {
        ("needs_my_review", "Потрібен ваш review")
    } else {
        ("assigned_to_me", "PR призначений вам")
    };

    PullRequestSummary {
        number: pr.number,
        repository: pr.repository.name_with_owner,
        title: pr.title,
        url: pr.url,
        updated_at: pr.updated_at,
        is_draft: pr.is_draft,
        role: role.to_string(),
        category: category.to_string(),
        action: action.to_string(),
        reviewers,
        failed_checks,
        merge_state: pr.merge_state_status,
    }
}

fn author_action(
    pr: &PullRequestNode,
    failed_checks: &[String],
    reviewers: &[String],
) -> (&'static str, &'static str) {
    if pr.is_draft {
        return (
            "needs_my_action",
            "Завершіть чернетку або позначте PR ready for review",
        );
    }
    if pr.review_decision.as_deref() == Some("CHANGES_REQUESTED") {
        return ("needs_my_action", "Внесіть зміни за результатами review");
    }
    if pr.merge_state_status == "DIRTY" {
        return ("needs_my_action", "Усуньте конфлікти з базовою гілкою");
    }
    if !failed_checks.is_empty() {
        return (
            "needs_my_action",
            "Перевірте та виправте провалені CI checks",
        );
    }
    if !reviewers.is_empty() {
        return ("waiting_for_others", "Очікує review від призначених осіб");
    }
    ("waiting_for_others", "Очікує рішення мейнтейнера")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pr() -> PullRequestNode {
        PullRequestNode {
            number: 1,
            title: "Test".to_string(),
            url: "https://example.test/pr/1".to_string(),
            updated_at: "2026-07-27T00:00:00Z".to_string(),
            is_draft: false,
            review_decision: None,
            merge_state_status: "CLEAN".to_string(),
            repository: Repository {
                name_with_owner: "owner/repo".to_string(),
            },
            review_requests: ReviewRequests::default(),
            status_check_rollup: None,
        }
    }

    #[test]
    fn author_with_failed_ci_needs_action() {
        let summary = summarize(pr(), HashSet::from(["author"]));
        assert_eq!(summary.category, "waiting_for_others");

        let mut failing = pr();
        failing.status_check_rollup = Some(StatusCheckRollup {
            contexts: CheckContexts {
                nodes: vec![CheckContext {
                    name: Some("lint".to_string()),
                    context: None,
                    conclusion: Some("FAILURE".to_string()),
                    state: None,
                }],
            },
        });
        let summary = summarize(failing, HashSet::from(["author"]));
        assert_eq!(summary.category, "needs_my_action");
        assert_eq!(summary.failed_checks, ["lint"]);
    }

    #[test]
    fn requested_reviewer_gets_review_action() {
        let summary = summarize(pr(), HashSet::from(["reviewer"]));
        assert_eq!(summary.category, "needs_my_review");
    }
}
