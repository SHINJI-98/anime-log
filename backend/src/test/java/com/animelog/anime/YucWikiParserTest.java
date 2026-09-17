package com.animelog.anime;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

class YucWikiParserTest {
    private final YucWikiParser parser = new YucWikiParser();

    @Test
    void parsesAnimeFieldsAndAllowsMissingEpisodeCount() {
        String html = "<html><body>"
                + "<div class='main_box' id='a1'>"
                + "<h3>测试番剧 A</h3>"
                + "<img src='/images/a.jpg'>"
                + "<p class='time'>周六 23:30</p>"
                + "<p>全 12 话</p>"
                + "</div>"
                + "<div class='main_box' id='a2'>"
                + "<h3>测试番剧 B</h3>"
                + "<img src='/images/b.jpg'>"
                + "<p class='time'>周日 01:00</p>"
                + "</div>"
                + "</body></html>";

        List<ParsedAnime> results = parser.parse(html, "https://yuc.wiki/202607/");

        assertThat(results).hasSize(2);
        assertThat(results.get(0).getTitle()).isEqualTo("测试番剧 A");
        assertThat(results.get(0).getImageUrl()).isEqualTo("https://yuc.wiki/images/a.jpg");
        assertThat(results.get(0).getAirTime()).isEqualTo("周六 23:30");
        assertThat(results.get(0).getTotalEpisodes()).isEqualTo(12);
        assertThat(results.get(1).getTitle()).isEqualTo("测试番剧 B");
        assertThat(results.get(1).getTotalEpisodes()).isNull();
    }
    @Test
    void prefersYucWikiDateTitleCellForAnimeName() {
        String html = "<html><body><table>"
                + "<tr id='anime-1'>"
                + "<td class='date_title_'>Correct Anime Title</td>"
                + "<td><a href='/202607/anime-1.html'>Detail Link Text</a></td>"
                + "<td><img src='/images/title.jpg'></td>"
                + "<td class='time'>Friday 22:00</td>"
                + "</tr>"
                + "</table></body></html>";

        List<ParsedAnime> results = parser.parse(html, "https://yuc.wiki/202607/");

        assertThat(results).hasSize(1);
        assertThat(results.get(0).getTitle()).isEqualTo("Correct Anime Title");
    }

    @Test
    void assignsWeekdayFromNearestYucWikiDateHeader() {
        String html = "<html><body>"
                + "<div><table class='date_'><tr><td class='date2'>周一 (月)</td></tr></table></div>"
                + "<div><div style='float:left'><div class='div_date'><p class='imgtext5'>23:00~</p>"
                + "<img data-src='https://example.com/monday.jpg'></div><div><table><tr>"
                + "<td class='date_title_'>Monday Anime</td></tr></table></div></div></div>"
                + "<div><table class='date_'><tr><td class='date2'>周二 (火)</td></tr></table></div>"
                + "<div><div style='float:left'><div class='div_date'><p class='imgtext5'>21:30~</p>"
                + "<img data-src='https://example.com/tuesday.jpg'></div><div><table><tr>"
                + "<td class='date_title_'>Tuesday Anime</td></tr></table></div></div></div>"
                + "</body></html>";

        List<ParsedAnime> results = parser.parse(html, "https://yuc.wiki/202607/");

        assertThat(results).hasSize(2);
        assertThat(results.get(0).getTitle()).isEqualTo("Monday Anime");
        assertThat(results.get(0).getAirDay()).isEqualTo("周一 (月)");
        assertThat(results.get(1).getTitle()).isEqualTo("Tuesday Anime");
        assertThat(results.get(1).getAirDay()).isEqualTo("周二 (火)");
    }

    @Test
    void parsesNetworkCardImageFromUnderscoredDateBlock() {
        String html = "<html><body>"
                + "<div><table class='date_'><tr><td class='date2'>网络放送 &amp; 其他</td></tr></table></div>"
                + "<div><div style='float:left'>"
                + "<div class='div_date_'><img data-src='https://example.com/cyborg.jpg'></div>"
                + "<div><table><tr><td class='date_title_'>Cyborg 009 Nemesis</td></tr>"
                + "<tr class='tr_area'><td><p class='pmfs'>7/19网络放送</p></td></tr>"
                + "<tr class='tr_area_ex'><td><p class='paomian'>(全3话)</p></td></tr>"
                + "</table></div></div></div>"
                + "</body></html>";

        List<ParsedAnime> results = parser.parse(html, "https://yuc.wiki/202607/");

        assertThat(results).hasSize(1);
        assertThat(results.get(0).getTitle()).isEqualTo("Cyborg 009 Nemesis");
        assertThat(results.get(0).getImageUrl()).isEqualTo("https://example.com/cyborg.jpg");
        assertThat(results.get(0).getAirDay()).isEqualTo("网络放送 & 其他");
        assertThat(results.get(0).getAirTime()).isEqualTo("7/19");
        assertThat(results.get(0).getTotalEpisodes()).isEqualTo(3);
    }
}
