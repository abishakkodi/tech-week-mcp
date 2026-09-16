"""Extract the copied Tech Week HTML without network access or dependencies."""
import json
import re
from datetime import datetime, timezone
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def text(self):
        return ''.join(c.text() if isinstance(c, Node) else c for c in self.children)

    def find(self, predicate):
        for child in self.children:
            if isinstance(child, Node):
                if predicate(child):
                    yield child
                yield from child.find(predicate)


class Rows(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self.stack = [], []

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            assert not self.stack, 'Unexpected nested row'
            node = Node(tag, attrs)
            self.rows.append(node)
            self.stack = [node]
        elif self.stack:
            node = Node(tag, attrs)
            self.stack[-1].children.append(node)
            if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
                self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, data):
        if self.stack:
            self.stack[-1].children.append(data)


def clean(value):
    return re.sub(r'\s+', ' ', value).strip()


def first(node, predicate):
    return next(node.find(predicate))


def md(value):
    return re.sub(r'([\\`*_{}\[\]<>|])', r'\\\1', value)


def main():
    source = ROOT / 'techlist.md'
    parser = Rows()
    parser.feed(source.read_text())
    parser.close()
    assert not parser.stack, 'Incomplete HTML row'
    events, seen, duplicates = [], set(), 0
    date_label = None
    date_pattern = r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]{2} \d{1,2}'
    event_rows = 0
    for row_index, row in enumerate(parser.rows, 1):
        cells = [c for c in row.children if isinstance(c, Node) and c.tag == 'td']
        if len(cells) == 1 and re.fullmatch(date_pattern, clean(cells[0].text())):
            date_label = clean(cells[0].text())
            continue
        titles = list(row.find(lambda n: 'event-title' in n.attrs.get('class', '').split()))
        if not titles:
            assert row.attrs.get('data-slot') != 'table-row' or not cells, f'Unrecognized event row {row_index}'
            continue
        event_rows += 1
        assert date_label and len(cells) == 5, f'Unexpected structure at row {row_index}'
        title = clean(titles[0].text())
        assert all(clean(t.text()) == title for t in titles), f'Conflicting titles at row {row_index}'
        hrefs = {n.attrs['href'] for n in row.find(lambda n: n.tag == 'a' and 'href' in n.attrs)}
        assert len(hrefs) == 1, f'Conflicting links at row {row_index}'
        href = hrefs.pop()
        event_url = urljoin('https://www.tech-week.com', href)
        parsed_event_url = urlparse(event_url)
        assert (
            parsed_event_url.scheme == 'https'
            and parsed_event_url.netloc == 'www.tech-week.com'
            and re.fullmatch(r'/go/event/[A-Za-z0-9_-]+', parsed_event_url.path)
            and not parsed_event_url.params
            and not parsed_event_url.query
            and not parsed_event_url.fragment
        ), f'Untrusted event URL at row {row_index}'
        time_text = clean(cells[0].text()).removesuffix('·').strip()
        assert re.fullmatch(r'\d{1,2}:\d{2}[ap]m', time_text), f'Unexpected time: {time_text}'
        host_nodes = list(cells[2].find(lambda n: n.tag == 'span'))
        host = clean(host_nodes[0].text())
        assert all(clean(n.text()) == host for n in host_nodes), f'Conflicting host at row {row_index}'
        neighborhood = clean(cells[3].text())
        labels = [clean(n.text()) for n in cells[1].find(lambda n: n.attrs.get('data-slot') == 'badge')]
        event = {
            'date_label': date_label,
            'start_time_display': time_text,
            'title': title,
            'host': host,
            'neighborhood': neighborhood,
            'labels': list(dict.fromkeys(labels)),
            'event_url': event_url,
            'source_row': row_index,
        }
        key = json.dumps({k: v for k, v in event.items() if k != 'source_row'}, sort_keys=True)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        events.append(event)
    assert events and len(events) + duplicates == event_rows
    notes = [
        'Extracted from the local HTML snapshot in techlist.md; not live-verified.',
        'Dates and times retain the source-row wording. The MCP layer assigns the verified 2026 calendar year and America/Los_Angeles timezone for scheduling.',
        'Tech Week redirect URLs are preserved; destination platforms and RSVP availability are unknown.',
        'Mobile/desktop repetitions are collapsed; only identical event records are deduplicated.',
        'Neighborhoods are not venue addresses. End times, prices, and descriptions are not supplied by these rows.',
        'All listed dates are retained, including dates outside the October 5-11 SF headline range.',
    ]
    # ISO-8601 UTC with Z suffix, e.g., 2026-09-16T13:00:00Z
    snapshot_generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    payload = {
        'source_file': 'techlist.md',
        'notes': notes,
        'event_count': len(events),
        'source_event_rows': event_rows,
        'exact_duplicates_removed': duplicates,
        'snapshot_generated_at': snapshot_generated_at,
        'events': events
    }
    (ROOT / 'techlist.cleaned.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    lines = ['# Tech Week — cleaned event list', '', f'{len(events)} events extracted from `techlist.md`.', '']
    lines += [f'- {note}' for note in notes]
    last_date = None
    for event in events:
        if event['date_label'] != last_date:
            last_date = event['date_label']
            lines += ['', f'## {last_date}', '', '| Time | Event | Host | Neighborhood | Labels |', '| --- | --- | --- | --- | --- |']
        lines.append(f"| {event['start_time_display']} | [{md(event['title'])}]({event['event_url']}) | {md(event['host'])} | {md(event['neighborhood'])} | {md(', '.join(event['labels']))} |")
    (ROOT / 'techlist.cleaned.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({'events': len(events), 'source_event_rows': event_rows, 'duplicates_removed': duplicates,
                      'by_date': dict(Counter(e['date_label'] for e in events))}, indent=2))


if __name__ == '__main__':
    main()
