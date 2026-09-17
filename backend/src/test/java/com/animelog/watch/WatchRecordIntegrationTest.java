package com.animelog.watch;

import static org.assertj.core.api.Assertions.assertThat;

import com.animelog.anime.AnimeRepository;
import com.animelog.anime.ParsedAnime;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "anime-log.database-path=target/test-anime-log.db")
class WatchRecordIntegrationTest {
    @Autowired
    private AnimeRepository animeRepository;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanDatabase() {
        jdbcTemplate.update("DELETE FROM watch_records");
        jdbcTemplate.update("DELETE FROM anime_sources");
    }

    @Test
    void createsUpdatesAndDeletesWatchRecordWithoutDuplicates() throws Exception {
        animeRepository.upsertFromParsed(
                "202607",
                new ParsedAnime("测试番剧", "https://example.com/a.jpg", "周六", 12, "https://yuc.wiki/202607/#a"));
        Long animeId = animeRepository.findBySeason("202607").get(0).getId();

        WatchRecordRequest create = new WatchRecordRequest();
        create.setAnimeSourceId(animeId);
        create.setStatus(WatchStatus.watching);
        create.setWatchedEpisodes(1);
        WatchRecord first = objectMapper.readValue(mockMvc.perform(post("/api/watch-records")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(create)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), WatchRecord.class);

        WatchRecordRequest duplicate = new WatchRecordRequest();
        duplicate.setAnimeSourceId(animeId);
        duplicate.setStatus(WatchStatus.completed);
        duplicate.setWatchedEpisodes(12);
        WatchRecord second = objectMapper.readValue(mockMvc.perform(post("/api/watch-records")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(duplicate)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), WatchRecord.class);

        assertThat(second.getId()).isEqualTo(first.getId());
        assertThat(second.getStatus()).isEqualTo(WatchStatus.completed);
        assertThat(second.getWatchedEpisodes()).isEqualTo(12);
        WatchRecord[] afterDuplicate = objectMapper.readValue(mockMvc.perform(get("/api/watch-records"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), WatchRecord[].class);
        assertThat(afterDuplicate).hasSize(1);

        WatchRecordUpdateRequest update = new WatchRecordUpdateRequest();
        update.setStatus(WatchStatus.dropped);
        update.setWatchedEpisodes(3);
        WatchRecord updated = objectMapper.readValue(mockMvc.perform(patch("/api/watch-records/" + first.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(update)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), WatchRecord.class);
        assertThat(updated.getStatus()).isEqualTo(WatchStatus.dropped);
        assertThat(updated.getWatchedEpisodes()).isEqualTo(3);

        mockMvc.perform(delete("/api/watch-records/" + first.getId()))
                .andExpect(status().isOk());
        WatchRecord[] afterDelete = objectMapper.readValue(mockMvc.perform(get("/api/watch-records"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), WatchRecord[].class);
        assertThat(afterDelete).isEmpty();
    }
}
