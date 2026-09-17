package com.animelog.anime;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.stereotype.Component;

@Component
public class YucWikiParser {
    private static final Pattern EPISODE_PATTERN = Pattern.compile("(?:\\u5168|\\u5171)\\s*(\\d{1,3})\\s*(?:\\u8bdd|\\u8a71|\\u96c6)");
    private static final Pattern AIR_TIME_PATTERN = Pattern.compile("(\\d{1,2}[:\\uff1a]\\d{2}|\\d{1,2}/\\d{1,2}|\\d{1,2}\\u6708\\d{1,2}\\u65e5|\\u5468[\\u4e00\\u4e8c\\u4e09\\u56db\\u4e94\\u516d\\u65e5\\u5929]|\\u661f\\u671f[\\u4e00\\u4e8c\\u4e09\\u56db\\u4e94\\u516d\\u65e5\\u5929])");

    public List<ParsedAnime> parse(String html, String pageUrl) {
        Document document = Jsoup.parse(html, pageUrl);
        Map<String, ParsedAnime> bySource = new LinkedHashMap<String, ParsedAnime>();

        collectScheduleCards(document.body(), null, pageUrl, bySource);
        if (!bySource.isEmpty()) {
            return new ArrayList<ParsedAnime>(bySource.values());
        }

        Elements candidates = document.select(".title_main_r, tr, .div_date, .date2, .main_box, .entry, .anime, .item, li, article");
        for (Element candidate : candidates) {
            if (candidate.selectFirst("td[class^=date_title]") != null) {
                continue;
            }
            ParsedAnime anime = parseCandidate(candidate, pageUrl);
            if (anime != null) {
                bySource.put(anime.getSourceUrl(), anime);
            }
        }

        if (bySource.isEmpty()) {
            for (Element image : document.select("img")) {
                Element candidate = image.parent();
                for (int i = 0; i < 3 && candidate != null; i++) {
                    ParsedAnime anime = parseCandidate(candidate, pageUrl);
                    if (anime != null) {
                        bySource.put(anime.getSourceUrl(), anime);
                        break;
                    }
                    candidate = candidate.parent();
                }
            }
        }

        return new ArrayList<ParsedAnime>(bySource.values());
    }

    private String collectScheduleCards(Element element, String currentDay, String pageUrl, Map<String, ParsedAnime> bySource) {
        String day = currentDay;
        for (Element child : element.children()) {
            String childDay = findDayLabel(child);
            if (childDay != null) {
                day = childDay;
            }
            if (isDateTitleCell(child)) {
                ParsedAnime anime = parseDateTitleCard(child, day, pageUrl);
                if (anime != null) {
                    bySource.put(anime.getSourceUrl(), anime);
                }
            }
            day = collectScheduleCards(child, day, pageUrl, bySource);
        }
        return day;
    }

    private ParsedAnime parseDateTitleCard(Element titleCell, String airDay, String pageUrl) {
        String title = cleanTitle(titleCell.text());
        if (title == null) {
            return null;
        }

        Element table = titleCell.closest("table");
        Element tableWrap = table == null ? null : table.parent();
        Element card = tableWrap == null ? null : tableWrap.parent();
        Element dateBlock = card == null ? null : card.selectFirst(".div_date, .div_date_");
        String imageUrl = absoluteImageUrl(dateBlock == null ? null : dateBlock.selectFirst("img"));
        String dateText = card == null ? "" : normalize(card.text());
        String airTime = findScheduleAirTime(dateBlock, dateText);
        Integer totalEpisodes = findTotalEpisodes(dateText);
        String sourceUrl = pageUrl + "#date-" + Integer.toHexString(title.hashCode());

        return new ParsedAnime(title, imageUrl, airDay, airTime, totalEpisodes, sourceUrl);
    }

    private boolean isDateTitleCell(Element element) {
        return "td".equals(element.tagName()) && element.className().startsWith("date_title");
    }

    private String findDayLabel(Element element) {
        if (!element.hasClass("date2")) {
            return null;
        }
        String value = normalize(element.text());
        return value.isEmpty() ? null : value;
    }

    private ParsedAnime parseCandidate(Element candidate, String pageUrl) {
        String title = findTitle(candidate);
        String imageUrl = absoluteImageUrl(candidate.selectFirst("img"));
        String sourceUrl = findSourceUrl(candidate, pageUrl);
        String text = normalize(candidate.text());
        Integer totalEpisodes = findTotalEpisodes(text);
        String airTime = findAirTime(candidate, text);

        if (title == null || title.length() < 2) {
            return null;
        }
        if (imageUrl == null && text.length() < title.length() + 8) {
            return null;
        }
        return new ParsedAnime(title, imageUrl, airTime, totalEpisodes, sourceUrl);
    }

    private String findTitle(Element candidate) {
        if ("td".equals(candidate.tagName()) && candidate.className().startsWith("date_title")) {
            String title = cleanTitle(candidate.text());
            if (title != null) {
                return title;
            }
        }

        String[] selectors = {
                "td[class^=date_title]",
                ".title_main_r p[class^=title_cn]",
                "p[class^=title_cn]",
                "td[class^=future_title]",
                ".title",
                ".name",
                "h1",
                "h2",
                "h3",
                "h4",
                "a[title]"
        };
        for (String selector : selectors) {
            Element element = candidate.selectFirst(selector);
            String title = cleanTitle(element == null ? null : element.hasAttr("title") ? element.attr("title") : element.text());
            if (title != null) {
                return title;
            }
        }

        return cleanTitle(candidate.ownText());
    }

    private String findSourceUrl(Element candidate, String pageUrl) {
        Element link = candidate.selectFirst("a[href]");
        String href = absoluteAttr(link, "href");
        if (href != null) {
            return href;
        }
        Element anchor = candidate.selectFirst("[id]");
        if (anchor != null && anchor.id() != null && !anchor.id().isEmpty()) {
            return pageUrl + "#" + anchor.id();
        }
        String title = findTitle(candidate);
        return pageUrl + "#" + Integer.toHexString((title == null ? candidate.text() : title).hashCode());
    }

    private String findAirTime(Element candidate, String text) {
        String[] selectors = { ".broadcast_r", "p[class^=imgtext]", ".time", ".date", ".onair", ".broadcast", ".pub" };
        for (String selector : selectors) {
            Element element = candidate.selectFirst(selector);
            if (element != null) {
                String value = normalize(element.text());
                if (!value.isEmpty()) {
                    return value;
                }
            }
        }

        Matcher matcher = AIR_TIME_PATTERN.matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return null;
    }

    private String findScheduleAirTime(Element dateBlock, String text) {
        if (dateBlock == null) {
            return null;
        }
        Element time = dateBlock.selectFirst("p[class^=imgtext]");
        if (time != null) {
            String value = normalize(time.text());
            if (!value.isEmpty()) {
                return value;
            }
        }
        return findAirTime(dateBlock, text);
    }

    private Integer findTotalEpisodes(String text) {
        Matcher matcher = EPISODE_PATTERN.matcher(text);
        if (matcher.find()) {
            return Integer.valueOf(matcher.group(1));
        }
        return null;
    }

    private String absoluteImageUrl(Element element) {
        String src = absoluteAttr(element, "data-src");
        return normalizeImageUrl(src == null ? absoluteAttr(element, "src") : src);
    }

    private String normalizeImageUrl(String value) {
        if (value != null && value.startsWith("http://i") && value.contains(".hdslb.com/")) {
            return "https://" + value.substring("http://".length());
        }
        return value;
    }

    private String absoluteAttr(Element element, String attr) {
        if (element == null || !element.hasAttr(attr)) {
            return null;
        }
        String value = element.absUrl(attr);
        if (value == null || value.isEmpty()) {
            value = element.attr(attr);
        }
        return value == null || value.isEmpty() ? null : value;
    }

    private String cleanTitle(String value) {
        String title = normalize(value);
        if (title.isEmpty() || title.length() > 80) {
            return null;
        }
        String lower = title.toLowerCase();
        if (lower.startsWith("http")
                || title.contains("\u65b0\u756a")
                || title.contains("\u66f4\u65b0\u65f6\u95f4")
                || title.contains("\u52a8\u753b\u5b98\u7f51")
                || title.equalsIgnoreCase("PV")) {
            return null;
        }
        return title;
    }

    private String normalize(String value) {
        return value == null ? "" : value.replace('\u00a0', ' ').replaceAll("\\s+", " ").trim();
    }
}
