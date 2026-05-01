use clap::{Parser, Subcommand};
use regex::Regex;
use scraper::{Html, Selector};
use std::borrow::Cow;
use std::process;

#[derive(Parser)]
#[command(name = "web-search", about = "Web search and URL text extraction")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Search the web via DuckDuckGo
    Search {
        /// Search query
        query: String,

        /// Max results
        #[arg(short, long, default_value = "5")]
        max: usize,

        /// Language code
        #[arg(long, default_value = "auto")]
        lang: String,

        /// Region code
        #[arg(long, default_value = "auto")]
        region: String,

        /// Time filter
        #[arg(long, value_parser = ["day", "week", "month", "today", "year"])]
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

fn main() {
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
        } => run_search(&query, max, &lang, &region, fresh.as_deref(), extract, extract_all, json),
        Commands::Fetch { url, max, title, source } => run_fetch(&url, max, title, source),
    }
}

// ---- Search ----

fn run_search(
    query: &str,
    max_results: usize,
    lang: &str,
    region: &str,
    fresh: Option<&str>,
    extract: bool,
    extract_all: bool,
    json: bool,
) {
    let results = search_ddg(query, max_results, lang, region, fresh);

    if results.is_empty() {
        process::exit(1);
    }

    if extract {
        if let Some(html) = fetch_html(&results[0].link) {
            let text = extract_text(&html);
            println!("\n--- Content from: {} ---\n", results[0].link);
            println!("{}", text);
            println!("\n--- End of content ---\n");
        }
    }

    if extract_all {
        for (i, r) in results.iter().enumerate() {
            if let Some(html) = fetch_html(&r.link) {
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

fn run_fetch(url: &str, max_chars: usize, title: bool, source: bool) {
    let html = match fetch_html(url) {
        Some(h) => h,
        None => process::exit(1),
    };

    let text = extract_text(&html);
    let text = if text.len() > max_chars {
        let end = text.char_indices()
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

// ---- DuckDuckGo Search ----

fn search_ddg(
    query: &str,
    max_results: usize,
    lang: &str,
    region: &str,
    fresh: Option<&str>,
) -> Vec<SearchResult> {
    let mut url = format!("https://html.duckduckgo.com/html/?q={}", url_encode(query));
    if lang != "auto" {
        url.push_str("&df=");
        url.push_str(lang);
    }
    if region != "auto" {
        url.push_str("&kl=");
        url.push_str(&region.replace("-", ""));
    }
    if let Some(f) = fresh {
        let m: std::collections::HashMap<&str, &str> = [
            ("day", "d"), ("week", "w"), ("month", "m"),
            ("today", "t"), ("year", "y"),
        ].iter().cloned().collect();
        url.push_str(&format!("&rank={}", m.get(f).copied().unwrap_or("d")));
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")
        .gzip(true)
        .build()
        .unwrap();

    let resp = match client.get(&url).send() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Error: DuckDuckGo request failed: {}", e);
            return vec![];
        }
    };

    let html = match resp.text() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Error reading response: {}", e);
            return vec![];
        }
    };

    let document = Html::parse_document(&html);
    let link_sel = Selector::parse(r#"a.result__a"#).unwrap();
    let snippet_sel = Selector::parse(r#"a.result__snippet"#).unwrap();

    let mut results = Vec::new();
    for link_el in document.select(&link_sel) {
        let raw_link = link_el.value().attr("href").unwrap_or("");
        let link = resolve_ddg_link(raw_link);
        let title = link_el.text().collect::<String>();
        let title = collapse_whitespace(&title);
        let snippet = find_snippet_ahead(&document, &link_el, &snippet_sel);

        if !title.is_empty() && !link.is_empty() {
            results.push(SearchResult { title, link, snippet });
            if results.len() >= max_results {
                break;
            }
        }
    }

    results
}

fn find_snippet_ahead<'a>(
    document: &'a Html,
    link_el: &scraper::ElementRef<'a>,
    snippet_sel: &Selector,
) -> String {
    let target_href = link_el.value().attr("href").unwrap_or("");
    let all_a = Selector::parse("a").unwrap();
    let mut anchors: Vec<(usize, &str, bool)> = Vec::new();
    for (i, el) in document.select(&all_a).enumerate() {
        let href = el.value().attr("href").unwrap_or("");
        let classes = el.value().attr("class").unwrap_or("");
        let is_snippet = classes.contains("result__snippet");
        anchors.push((i, href, is_snippet));
    }

    for (i, (_, href, is_snip)) in anchors.iter().enumerate() {
        if *is_snip || *href != target_href {
            continue;
        }
        for (j, (_, _, is_snip)) in anchors.iter().enumerate().skip(i + 1) {
            if *is_snip {
                if let Some(snip_el) = document.select(snippet_sel).nth(j) {
                    return collapse_whitespace(&snip_el.text().collect::<String>());
                }
            }
        }
        break;
    }
    String::new()
}

// ---- HTML Fetching ----

fn fetch_html(url: &str) -> Option<String> {
    let url = resolve_ddg_link(url);

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")
        .gzip(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap();

    match client.get(&url).send() {
        Ok(resp) => resp.text().ok(),
        Err(e) => {
            eprintln!("Error fetching {}: {}", url, e);
            None
        }
    }
}

fn resolve_ddg_link(link: &str) -> String {
    let decoded = url_decode(link);
    let re = UDDG_RE.get_or_init(|| Regex::new(r"uddg=([^&]+)").unwrap());
    if let Some(caps) = re.captures(&decoded) {
        return url_decode(&caps[1]);
    }
    decoded
}

// ---- Text Extraction ----

const SKIP_TAGS: &[&str] = &[
    "script", "style", "noscript", "iframe", "nav", "footer", "header",
];

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

static UDDG_RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

fn url_encode(s: &str) -> String {
    urlencoding::encode(s).to_string()
}

fn url_decode(s: &str) -> String {
    urlencoding::decode(s).unwrap_or_else(|_| Cow::Borrowed(s)).into_owned()
}

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
        let end = s.char_indices()
            .nth(max)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        format!("{}...", &s[..end])
    }
}
