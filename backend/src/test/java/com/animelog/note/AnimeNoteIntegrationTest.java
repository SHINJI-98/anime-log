package com.animelog.note;

import static org.assertj.core.api.Assertions.assertThat;

import com.animelog.anime.AnimeRepository;
import com.animelog.anime.ParsedAnime;
import com.animelog.watch.WatchRecord;
import com.animelog.watch.WatchRecordRequest;
import com.animelog.watch.WatchStatus;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "anime-log.database-path=target/test-anime-log.db")
class AnimeNoteIntegrationTest {
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
        jdbcTemplate.update("DELETE FROM anime_notes");
        jdbcTemplate.update("DELETE FROM watch_records");
        jdbcTemplate.update("DELETE FROM anime_sources");
    }

    @Test
    void savesSummaryAndEpisodeNotesWithoutDuplicates() throws Exception {
        Long animeId = createAnime();

        AnimeNoteRequest summary = new AnimeNoteRequest();
        summary.setContent("# Summary\nGood start.");
        AnimeNote savedSummary = objectMapper.readValue(mockMvc.perform(put("/api/anime/" + animeId + "/notes/summary")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(summary)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), AnimeNote.class);
        assertThat(savedSummary.getEpisodeNumber()).isEqualTo(0);
        assertThat(savedSummary.getContent()).contains("Good start");

        AnimeNoteRequest episode = new AnimeNoteRequest();
        episode.setContent("Episode 1 note");
        AnimeNote firstEpisode = objectMapper.readValue(mockMvc.perform(put("/api/anime/" + animeId + "/notes/episodes/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(episode)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), AnimeNote.class);

        episode.setContent("Episode 1 updated");
        AnimeNote updatedEpisode = objectMapper.readValue(mockMvc.perform(put("/api/anime/" + animeId + "/notes/episodes/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(episode)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), AnimeNote.class);

        assertThat(updatedEpisode.getId()).isEqualTo(firstEpisode.getId());
        assertThat(updatedEpisode.getContent()).isEqualTo("Episode 1 updated");
        Integer noteCount = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM anime_notes", Integer.class);
        assertThat(noteCount).isEqualTo(2);

        AnimeNotesResponse response = objectMapper.readValue(mockMvc.perform(get("/api/anime/" + animeId + "/notes"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), AnimeNotesResponse.class);
        assertThat(response.getSummary().getContent()).contains("Good start");
        assertThat(response.getEpisodeNotes()).hasSize(1);
        assertThat(response.getEpisodeNotes().get(0).getEpisodeNumber()).isEqualTo(1);

        mockMvc.perform(delete("/api/anime/" + animeId + "/notes/episodes/1"))
                .andExpect(status().isOk());
        AnimeNotesResponse afterDelete = objectMapper.readValue(mockMvc.perform(get("/api/anime/" + animeId + "/notes"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), AnimeNotesResponse.class);
        assertThat(afterDelete.getSummary()).isNotNull();
        assertThat(afterDelete.getEpisodeNotes()).isEmpty();
    }

    @Test
    void keepsNotesAfterWatchRecordIsDeleted() throws Exception {
        Long animeId = createAnime();
        WatchRecordRequest create = new WatchRecordRequest();
        create.setAnimeSourceId(animeId);
        create.setStatus(WatchStatus.watching);
        create.setWatchedEpisodes(2);
        WatchRecord record = objectMapper.readValue(mockMvc.perform(post("/api/watch-records")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(create)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), WatchRecord.class);

        AnimeNoteRequest summary = new AnimeNoteRequest();
        summary.setContent("Still worth remembering.");
        mockMvc.perform(put("/api/anime/" + animeId + "/notes/summary")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(summary)))
                .andExpect(status().isOk());

        mockMvc.perform(delete("/api/watch-records/" + record.getId()))
                .andExpect(status().isOk());

        AnimeNotesResponse response = objectMapper.readValue(mockMvc.perform(get("/api/anime/" + animeId + "/notes"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(), AnimeNotesResponse.class);
        assertThat(response.getSummary().getContent()).isEqualTo("Still worth remembering.");
    }

    @Test
    void rejectsInvalidEpisodeAndUnknownAnime() throws Exception {
        Long animeId = createAnime();
        AnimeNoteRequest request = new AnimeNoteRequest();
        request.setContent("Invalid");

        mockMvc.perform(put("/api/anime/" + animeId + "/notes/episodes/-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/anime/999999/notes"))
                .andExpect(status().isNotFound());
    }

    @Test
    void acceptsBrowserOriginForPutRequests() throws Exception {
        Long animeId = createAnime();
        AnimeNoteRequest request = new AnimeNoteRequest();
        request.setContent("Browser request");

        mockMvc.perform(put("/api/anime/" + animeId + "/notes/episodes/1")
                        .header("Origin", "http://127.0.0.1:5173")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk());
    }

    private Long createAnime() {
        animeRepository.upsertFromParsed(
                "202607",
                new ParsedAnime("Test Anime", "https://example.com/a.jpg", "Monday", "23:00", 12,
                        "https://yuc.wiki/202607/#test"));
        return animeRepository.findBySeason("202607").get(0).getId();
    }
}
