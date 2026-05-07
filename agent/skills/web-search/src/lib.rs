pub mod client;
pub mod types;

pub use client::Client;
pub use types::*;

#[cfg(test)]
mod tests {
    use crate::types::*;

    #[test]
    fn test_search_query_builder() {
        let q = SearchQuery::new("rust")
            .categories("general")
            .language("en")
            .pageno(2)
            .safesearch(SafeSearch::Moderate);

        assert_eq!(q.q, "rust");
        assert_eq!(q.categories, Some("general".into()));
        assert_eq!(q.language, Some("en".into()));
        assert_eq!(q.pageno, Some(2));
        assert_eq!(q.safesearch, Some(SafeSearch::Moderate));
    }

    #[test]
    fn test_safe_search_as_u8() {
        assert_eq!(SafeSearch::Off.as_u8(), 0);
        assert_eq!(SafeSearch::Moderate.as_u8(), 1);
        assert_eq!(SafeSearch::Strict.as_u8(), 2);
    }

    #[test]
    fn test_time_range_display() {
        assert_eq!(format!("{}", TimeRange::Day), "day");
        assert_eq!(format!("{}", TimeRange::Month), "month");
        assert_eq!(format!("{}", TimeRange::Year), "year");
    }

    #[test]
    fn test_autocomplete_display() {
        assert_eq!(format!("{}", Autocomplete::Google), "google");
        assert_eq!(format!("{}", Autocomplete::Duckduckgo), "duckduckgo");
        assert_eq!(format!("{}", Autocomplete::Other), "other");
    }

    #[test]
    fn test_deserialize_minimal_response() {
        let json = r#"{"query":"test","results":[]}"#;
        let resp: SearchResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.query, "test");
        assert!(resp.results.is_empty());
    }

    #[test]
    fn test_deserialize_full_response() {
        let json = r#"{
            "query": "rust lang",
            "number_of_results": 1500.0,
            "results": [
                {
                    "url": "https://www.rust-lang.org",
                    "engine": "google",
                    "title": "Rust Programming Language",
                    "content": "A language empowering everyone...",
                    "score": 0.95
                }
            ],
            "answers": [],
            "corrections": [],
            "infoboxes": [],
            "suggestions": ["rust language", "rust vs go"],
            "unresponsive_engines": []
        }"#;
        let resp: SearchResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.query, "rust lang");
        assert_eq!(resp.number_of_results, 1500.0);
        assert_eq!(resp.results.len(), 1);
        assert_eq!(resp.results[0].title, "Rust Programming Language");
        assert_eq!(resp.results[0].url, Some("https://www.rust-lang.org".into()));
        assert_eq!(resp.suggestions, vec!["rust language", "rust vs go"]);
    }

    #[test]
    fn test_serialize_search_response() {
        let resp = SearchResponse {
            query: "test".into(),
            number_of_results: 42.0,
            results: vec![SearchResult {
                url: Some("https://example.com".into()),
                engine: "google".into(),
                title: "Example".into(),
                content: "An example site".into(),
                img_src: String::new(),
                iframe_src: String::new(),
                audio_src: String::new(),
                thumbnail: String::new(),
                publishedDate: None,
                pubdate: String::new(),
                length: None,
                priority: String::new(),
                engines: vec![],
                positions: vec![],
                score: 0.5,
                category: String::new(),
                template: String::new(),
                parsed_url: serde_json::Value::Null,
            }],
            answers: vec![],
            corrections: vec![],
            infoboxes: vec![],
            suggestions: vec![],
            unresponsive_engines: vec![],
        };

        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("Example"));
    }

    #[test]
    fn test_error_display() {
        let err = Error::InvalidUrl("empty".into());
        assert!(format!("{}", err).contains("Invalid URL"));
    }
}