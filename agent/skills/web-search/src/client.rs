use reqwest::Client as HttpClient;

use crate::types::*;

/// SearXNG client.
#[derive(Debug, Clone)]
pub struct Client {
    base_url: String,
    http: HttpClient,
}

impl Client {
    /// Create a new client pointing at the given SearXNG instance.
    ///
    /// Trailing slashes are stripped.
    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let base_url = base_url.into();
        if base_url.is_empty() {
            return Err(Error::InvalidUrl("base URL is empty".into()));
        }
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: HttpClient::builder().user_agent("searxng-rust/0.1.0").build()?,
        })
    }

    /// Perform a search using GET.
    pub async fn search(&self, query: SearchQuery) -> Result<SearchResponse> {
        let req = self.http.get(format!("{}/search", self.base_url));
        let req = Self::apply_params(req, &query);
        Self::execute(req).await
    }

    /// Perform a search using POST (form-encoded body).
    pub async fn search_post(&self, query: SearchQuery) -> Result<SearchResponse> {
        let mut form: Vec<(String, String)> = Vec::new();
        form.push(("q".into(), query.q));
        if let Some(cats) = query.categories {
            form.push(("categories".into(), cats));
        }
        if let Some(engines) = query.engines {
            form.push(("engines".into(), engines));
        }
        if let Some(lang) = query.language {
            form.push(("language".into(), lang));
        }
        if let Some(p) = query.pageno {
            form.push(("pageno".into(), p.to_string()));
        }
        if let Some(tr) = query.time_range {
            form.push(("time_range".into(), tr.to_string()));
        }
        if let Some(ss) = query.safesearch {
            form.push(("safesearch".into(), ss.as_u8().to_string()));
        }
        if let Some(ac) = query.autocomplete {
            form.push(("autocomplete".into(), ac.to_string()));
        }
        if let Some(plugins) = query.enabled_plugins {
            form.push(("enabled_plugins".into(), plugins.join(",")));
        }
        if let Some(plugins) = query.disabled_plugins {
            form.push(("disabled_plugins".into(), plugins.join(",")));
        }
        if let Some(engines) = query.enabled_engines {
            form.push(("enabled_engines".into(), engines.join(",")));
        }
        if let Some(engines) = query.disabled_engines {
            form.push(("disabled_engines".into(), engines.join(",")));
        }
        form.push(("format".into(), "json".into()));

        let req = self
            .http
            .post(format!("{}/search", self.base_url))
            .form(&form);
        Self::execute(req).await
    }

    fn apply_params(
        req: reqwest::RequestBuilder,
        query: &SearchQuery,
    ) -> reqwest::RequestBuilder {
        let mut builder = req.query(&[("q", query.q.as_str()), ("format", "json")]);
        if let Some(ref cats) = query.categories {
            builder = builder.query(&[("categories", cats)]);
        }
        if let Some(ref engines) = query.engines {
            builder = builder.query(&[("engines", engines)]);
        }
        if let Some(ref lang) = query.language {
            builder = builder.query(&[("language", lang)]);
        }
        if let Some(p) = query.pageno {
            builder = builder.query(&[("pageno", p)]);
        }
        if let Some(ref tr) = query.time_range {
            builder = builder.query(&[("time_range", &tr.to_string())]);
        }
        if let Some(ref ss) = query.safesearch {
            builder = builder.query(&[("safesearch", ss.as_u8())]);
        }
        if let Some(ref ac) = query.autocomplete {
            builder = builder.query(&[("autocomplete", &ac.to_string())]);
        }
        if let Some(ref plugins) = query.enabled_plugins {
            builder = builder.query(&[("enabled_plugins", &plugins.join(","))]);
        }
        if let Some(ref plugins) = query.disabled_plugins {
            builder = builder.query(&[("disabled_plugins", &plugins.join(","))]);
        }
        if let Some(ref engines) = query.enabled_engines {
            builder = builder.query(&[("enabled_engines", &engines.join(","))]);
        }
        if let Some(ref engines) = query.disabled_engines {
            builder = builder.query(&[("disabled_engines", &engines.join(","))]);
        }
        builder
    }

    async fn execute(req: reqwest::RequestBuilder) -> Result<SearchResponse> {
        let resp = req.send().await?;
        let status = resp.status();
        let body = resp.text().await.map_err(Error::Http)?;

        if !status.is_success() {
            return Err(Error::HttpStatus(status, body));
        }

        serde_json::from_str(&body).map_err(Error::Json)
    }
}