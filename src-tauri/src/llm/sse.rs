//! Line framing for `text/event-stream` bodies.
//!
//! Framing is provider-neutral; decoding one `data:` payload belongs to
//! `LlmProvider::parse_sse_data`.

use crate::llm::catalog::LlmProvider;
use crate::llm::provider::SseParseItem;

/// Appends network bytes and returns completed UTF-8 SSE items without lossy decoding.
pub fn push_sse_bytes(
    buffer: &mut Vec<u8>,
    chunk: &[u8],
    provider: LlmProvider,
) -> Result<Vec<SseParseItem>, String> {
    buffer.extend_from_slice(chunk);
    let mut items = Vec::new();
    while let Some(idx) = buffer.iter().position(|byte| *byte == b'\n') {
        let mut line: Vec<u8> = buffer.drain(..idx).collect();
        buffer.drain(..1);
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        let line = std::str::from_utf8(&line)
            .map_err(|error| format!("stream contains invalid UTF-8: {error}"))?;
        // `event:` / `id:` / comment lines carry no payload for us.
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() {
            continue;
        }
        if let Some(item) = provider.parse_sse_data(data) {
            items.push(item);
        }
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lines_across_chunk_boundaries() {
        let mut buf = Vec::new();
        let first = push_sse_bytes(
            &mut buf,
            b"data: {\"response\":\"Hi\"}\n",
            LlmProvider::Cloudflare,
        )
        .unwrap();
        assert_eq!(first, vec![SseParseItem::Text("Hi".into())]);

        let mut buf2 = Vec::new();
        assert!(
            push_sse_bytes(&mut buf2, b"data: {\"respon", LlmProvider::Cloudflare)
                .unwrap()
                .is_empty()
        );
        let rest = push_sse_bytes(
            &mut buf2,
            b"se\":\"there\"}\ndata: [DONE]\n",
            LlmProvider::Cloudflare,
        )
        .unwrap();
        assert_eq!(
            rest,
            vec![SseParseItem::Text("there".into()), SseParseItem::Done]
        );
    }

    /// A final event that never got its trailing newline still has to decode.
    #[test]
    fn flushes_a_last_line_without_newline() {
        let mut buffer = Vec::new();
        assert!(push_sse_bytes(
            &mut buffer,
            b"data: {\"response\":\"Hi\"}",
            LlmProvider::Cloudflare,
        )
        .unwrap()
        .is_empty());
        buffer.push(b'\n');
        assert_eq!(
            push_sse_bytes(&mut buffer, &[], LlmProvider::Cloudflare).unwrap(),
            vec![SseParseItem::Text("Hi".into())]
        );
    }

    #[test]
    fn preserves_utf8_characters_split_across_network_chunks() {
        let mut buffer = Vec::new();
        assert!(push_sse_bytes(
            &mut buffer,
            b"data: {\"response\":\"\xF0\x9F",
            LlmProvider::Cloudflare
        )
        .unwrap()
        .is_empty());

        assert_eq!(
            push_sse_bytes(&mut buffer, b"\x98\x80\"}\n", LlmProvider::Cloudflare).unwrap(),
            vec![SseParseItem::Text("😀".into())]
        );
    }

    /// Anthropic prefixes every payload with an `event:` line.
    #[test]
    fn ignores_event_and_comment_lines() {
        let mut buffer = Vec::new();
        let items = push_sse_bytes(
            &mut buffer,
            b": ping\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n",
            LlmProvider::Anthropic,
        )
        .unwrap();
        assert_eq!(items, vec![SseParseItem::Text("Hi".into())]);
    }
}
