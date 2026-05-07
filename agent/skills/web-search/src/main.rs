use clap::{Parser, Subcommand};
use scraper::{Html, Selector};
use web_search::{Client, SearchQuery, TimeRange};
use std::process;

#[derive(Parser)]
#[command(name = "web-search", about = "Web search via SearXNG and URL text extraction")]
struct Cli {
    /// SearXNG instance URL
    #[arg(long, env = "SEARXNG_URL", default_value = "http://127.0.0.1:9000")]
    url: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Search the web via SearXNG
    Search {
        /// Search query
        query: String,

        /// Max results
        #[arg(short, long, default_value = "5")]
        max: usize,

        /// Language code
        #[arg(long, default_value = "auto")]
        lang: String,

        /// Region code (mapped to language if not "auto")
        #[arg(long, default_value = "auto")]
        region: String,

        /// Time filter
        #[arg(long, value_parser = ["day", "month", "today", "year"])]
        fresh: Option<String>,

        /// Extract page content for top result
        #[arg(long)]
        extract: bool,

        /// Extract page content for all results
        #[arg(long)]
        extract_all: bool,

        /// Raw JSON output
        #[arg(long)]
        json: bool,
    },
    /// Extract visible text from a URL
    Fetch {
        /// URL to fetch
        url: String,

        /// Max characters of output (default: 8000)
        #[arg(short, long, default_value = "8000")]
        max: usize,

        /// Include page title
        #[arg(long)]
        title: bool,

        /// Include source URL in output
        #[arg(long)]
        source: bool,
    },
}

#[derive(serde::Serialize)]
struct SearchResult {
    title: String,
    link: String,
    snippet: String,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Search {
            query,
            max,
            lang,
            region,
            fresh,
            extract,
            extract_all,
            json,
        } => {
            run_search(&cli.url, &query, max, &lang, &region, fresh.as_deref(), extract, extract_all, json)
                .await
        }
        Commands::Fetch { url, max, title, source } => run_fetch(&url, max, title, source).await,
    }
}

// ---- Search ----

async fn run_search(
    base_url: &str,
    query: &str,
    max_results: usize,
    lang: &str,
    region: &str,
    fresh: Option<&str>,
    extract: bool,
    extract_all: bool,
    json: bool,
) {
    let client = match Client::new(base_url) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: {e}");
            process::exit(1);
        }
    };

    // Build language string: combine lang+region if set
    let language = if lang != "auto" || region != "auto" {
        let mut parts = Vec::new();
        if lang != "auto" {
            parts.push(lang.to_string());
        }
        if region != "auto" {
            parts.push(region.to_string());
        }
        Some(parts.join("-"))
    } else {
        None
    };

    // Map fresh to TimeRange
    let time_range = match fresh {
        Some("day") | Some("today") => Some(TimeRange::Day),
        Some("month") => Some(TimeRange::Month),
        Some("year") => Some(TimeRange::Year),
        _ => None,
    };

    let mut search_query = SearchQuery::new(query);
    if let Some(lang) = &language {
        search_query.language = Some(lang.clone());
    }
    if let Some(tr) = time_range {
        search_query.time_range = Some(tr);
    }

    let resp = match client.search(search_query).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: {e}");
            process::exit(1);
        }
    };

    let results: Vec<SearchResult> = resp
        .results
        .into_iter()
        .take(max_results)
        .map(|r| SearchResult {
            title: r.title,
            link: r.url.unwrap_or_default(),
            snippet: r.content,
        })
        .collect();

    if results.is_empty() {
        process::exit(1);
    }

    if extract {
        if let Some(html) = fetch_html(&results[0].link).await {
            let text = extract_text(&html);
            println!("\n--- Content from: {} ---\n", results[0].link);
            println!("{}", text);
            println!("\n--- End of content ---\n");
        }
    }

    if extract_all {
        for (i, r) in results.iter().enumerate() {
            if let Some(html) = fetch_html(&r.link).await {
                let text = extract_text(&html);
                println!("\n--- {}. {} ---\n", i + 1, r.title);
                println!("{}", text);
            }
        }
        println!();
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&results).unwrap());
    } else {
        for (i, r) in results.iter().enumerate() {
            println!("{}. {}", i + 1, r.title);
            println!("   {}", r.link);
            if !r.snippet.is_empty() {
                println!("   {}", truncate(&r.snippet, 200));
            }
            println!();
        }
    }
}

// ---- Fetch ----

async fn run_fetch(url: &str, max_chars: usize, title: bool, source: bool) {
    let html = match fetch_html(url).await {
        Some(h) => h,
        None => process::exit(1),
    };

    let text = extract_text(&html);
    let text = if text.len() > max_chars {
        let end = text
            .char_indices()
            .nth(max_chars)
            .map(|(i, _)| i)
            .unwrap_or(text.len());
        format!("{}...", &text[..end])
    } else {
        text
    };

    if source {
        println!("Source: {}", url);
        println!();
    }
    if title {
        if let Some(t) = extract_title(&html) {
            println!("Title: {}", t);
            println!();
        }
    }
    println!("{}", text);
}

// ---- HTML Fetching ----

async fn fetch_html(url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")
        .gzip(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap();

    match client.get(url).send().await {
        Ok(resp) => resp.text().await.ok(),
        Err(e) => {
            eprintln!("Error fetching {}: {}", url, e);
            None
        }
    }
}

// ---- Text Extraction ----

const SKIP_TAGS: &[&str] =
    &["script", "style", "noscript", "iframe", "nav", "footer", "header"];

fn extract_text(html: &str) -> String {
    let document = Html::parse_document(html);
    let body_selector = Selector::parse("body").unwrap();
    let mut text = String::new();
    for node in document.select(&body_selector) {
        collect_text(&node, &mut text);
    }
    collapse_whitespace(&text)
}

fn collect_text(element: &scraper::ElementRef<'_>, out: &mut String) {
    let tag = element.value().name();
    if SKIP_TAGS.iter().any(|&t| t == tag) {
        return;
    }
    for child in element.children() {
        if let scraper::Node::Text(text_node) = child.value() {
            let t = text_node.text.trim().to_string();
            if !t.is_empty() {
                out.push_str(&t);
                out.push(' ');
            }
        } else if let Some(child_ref) = scraper::ElementRef::wrap(child) {
            collect_text(&child_ref, out);
        }
    }
}

fn extract_title(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let title_selector = Selector::parse("title").unwrap();
    document
        .select(&title_selector)
        .next()
        .map(|el| collapse_whitespace(&el.text().collect::<String>()))
}

// ---- Helpers ----

fn collapse_whitespace(s: &str) -> String {
    let mut result = String::new();
    let mut prev_space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !prev_space {
                result.push(' ');
                prev_space = true;
            }
        } else {
            prev_space = false;
            result.push(c);
        }
    }
    result.trim().to_string()
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let end = s
            .char_indices()
            .nth(max)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        format!("{}...", &s[..end])
    }
}
