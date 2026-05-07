use serde::{Deserialize, Deserializer, Serialize};

/// Deserialize a `String`, treating `null` as empty string.
fn null_to_string<'de, D>(deserializer: D) -> std::result::Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    match Option::<String>::deserialize(deserializer)? {
        Some(s) => Ok(s),
        None => Ok(String::new()),
    }
}

/// Deserialize an `Option<String>`, handling double-null.
fn null_to_option_string<'de, D>(deserializer: D) -> std::result::Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<Option<String>>::deserialize(deserializer).map(|v| v.flatten())
}

/// Safe search filter level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SafeSearch {
    /// No filtering.
    Off,
    /// Moderate filtering.
    Moderate,
    /// Strict filtering.
    Strict,
}

impl SafeSearch {
    pub fn as_u8(&self) -> u8 {
        match self {
            SafeSearch::Off => 0,
            SafeSearch::Moderate => 1,
            SafeSearch::Strict => 2,
        }
    }
}

/// Time range for search results.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeRange {
    /// Last day.
    Day,
    /// Last month.
    Month,
    /// Last year.
    Year,
}

impl std::fmt::Display for TimeRange {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TimeRange::Day => write!(f, "day"),
            TimeRange::Month => write!(f, "month"),
            TimeRange::Year => write!(f, "year"),
        }
    }
}

/// Autocomplete service provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Autocomplete {
    Google,
    Dbpedia,
    Duckduckgo,
    Mwmbl,
    Startpage,
    Wikipedia,
    Swisscows,
    Qwant,
    #[serde(other)]
    Other,
}

impl std::fmt::Display for Autocomplete {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Autocomplete::Google => write!(f, "google"),
            Autocomplete::Dbpedia => write!(f, "dbpedia"),
            Autocomplete::Duckduckgo => write!(f, "duckduckgo"),
            Autocomplete::Mwmbl => write!(f, "mwmbl"),
            Autocomplete::Startpage => write!(f, "startpage"),
            Autocomplete::Wikipedia => write!(f, "wikipedia"),
            Autocomplete::Swisscows => write!(f, "swisscows"),
            Autocomplete::Qwant => write!(f, "qwant"),
            Autocomplete::Other => write!(f, "other"),
        }
    }
}

/// Search request parameters.
#[derive(Debug, Clone, Default)]
pub struct SearchQuery {
    /// The search query (required).
    pub q: String,
    /// Comma-separated search categories (e.g. "general,news").
    pub categories: Option<String>,
    /// Comma-separated search engines.
    pub engines: Option<String>,
    /// Language code (e.g. "en", "de").
    pub language: Option<String>,
    /// Page number (default: 1).
    pub pageno: Option<u32>,
    /// Time range filter.
    pub time_range: Option<TimeRange>,
    /// Safe search filter level.
    pub safesearch: Option<SafeSearch>,
    /// Autocomplete service.
    pub autocomplete: Option<Autocomplete>,
    /// List of enabled plugins.
    pub enabled_plugins: Option<Vec<String>>,
    /// List of disabled plugins.
    pub disabled_plugins: Option<Vec<String>>,
    /// List of enabled engines.
    pub enabled_engines: Option<Vec<String>>,
    /// List of disabled engines.
    pub disabled_engines: Option<Vec<String>>,
}

impl SearchQuery {
    pub fn new(q: impl Into<String>) -> Self {
        Self {
            q: q.into(),
            ..Default::default()
        }
    }

    pub fn categories(mut self, categories: impl Into<String>) -> Self {
        self.categories = Some(categories.into());
        self
    }

    pub fn engines(mut self, engines: impl Into<String>) -> Self {
        self.engines = Some(engines.into());
        self
    }

    pub fn language(mut self, language: impl Into<String>) -> Self {
        self.language = Some(language.into());
        self
    }

    pub fn pageno(mut self, pageno: u32) -> Self {
        self.pageno = Some(pageno);
        self
    }

    pub fn time_range(mut self, time_range: TimeRange) -> Self {
        self.time_range = Some(time_range);
        self
    }

    pub fn safesearch(mut self, safesearch: SafeSearch) -> Self {
        self.safesearch = Some(safesearch);
        self
    }

    pub fn autocomplete(mut self, autocomplete: Autocomplete) -> Self {
        self.autocomplete = Some(autocomplete);
        self
    }
}

fn is_nan(v: &f64) -> bool {
    v.is_nan()
}

/// A single search result from SearXNG.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct SearchResult {
    /// Result URL.
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Engine that produced this result.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub engine: String,
    /// Result title.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub title: String,
    /// Result description/extract.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub content: String,
    /// Image URL associated with the result.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub img_src: String,
    /// Embedded iframe URL.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub iframe_src: String,
    /// Embedded audio URL.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub audio_src: String,
    /// Thumbnail URL.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub thumbnail: String,
    /// Published date as ISO string.
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub publishedDate: Option<String>,
    /// Deprecated date string.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub pubdate: String,
    /// Playing duration in seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length: Option<f64>,
    /// Result priority.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub priority: String,
    /// Engines that contributed to this result.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub engines: Vec<String>,
    /// Original positions from engines.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub positions: Vec<u32>,
    /// Result score.
    #[serde(default, skip_serializing_if = "is_nan")]
    pub score: f64,
    /// Category of the result.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub category: String,
    /// Template used for rendering.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub template: String,
    /// Parsed URL (from JSON, may be array or null — ignored by client).
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub parsed_url: serde_json::Value,
}

/// An answer returned by SearXNG (direct answer from answerers).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Answer {
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub engine: String,
}

/// An infobox returned by SearXNG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Infobox {
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub img_src: Option<String>,
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attributes: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub urls: Option<Vec<serde_json::Value>>,
    #[serde(default, deserialize_with = "null_to_option_string", skip_serializing_if = "Option::is_none")]
    pub infobox: Option<String>,
}

/// Error from an unresponsive engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnresponsiveEngine {
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub engine: String,
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub error: String,
}

/// Full JSON response from SearXNG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    /// The original query string.
    #[serde(default, deserialize_with = "null_to_string", skip_serializing_if = "String::is_empty")]
    pub query: String,
    /// Number of results (may be approximate).
    #[serde(default, skip_serializing_if = "is_nan")]
    pub number_of_results: f64,
    /// Search results.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub results: Vec<SearchResult>,
    /// Direct answers.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub answers: Vec<Answer>,
    /// Query corrections/suggestions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub corrections: Vec<String>,
    /// Infoboxes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub infoboxes: Vec<Infobox>,
    /// Search suggestions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggestions: Vec<String>,
    /// Unresponsive engines with error messages.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unresponsive_engines: Vec<UnresponsiveEngine>,
}

/// Client error types.
#[derive(Debug)]
pub enum Error {
    /// HTTP request failed.
    Http(reqwest::Error),
    /// SearXNG returned a non-200 status.
    HttpStatus(reqwest::StatusCode, String),
    /// JSON deserialization failed.
    Json(serde_json::Error),
    /// Invalid base URL.
    InvalidUrl(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Http(e) => write!(f, "HTTP error: {e}"),
            Error::HttpStatus(code, body) => {
                write!(f, "HTTP {code}: {body}")
            }
            Error::Json(e) => write!(f, "JSON error: {e}"),
            Error::InvalidUrl(msg) => write!(f, "Invalid URL: {msg}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Http(e)
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e)
    }
}

pub type Result<T> = std::result::Result<T, Error>;