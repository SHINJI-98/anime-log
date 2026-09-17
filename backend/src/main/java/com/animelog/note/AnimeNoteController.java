package com.animelog.note;

import javax.validation.Valid;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/anime/{animeSourceId}/notes")
public class AnimeNoteController {
    private final AnimeNoteService animeNoteService;

    public AnimeNoteController(AnimeNoteService animeNoteService) {
        this.animeNoteService = animeNoteService;
    }

    @GetMapping
    public AnimeNotesResponse list(@PathVariable long animeSourceId) {
        return animeNoteService.findByAnimeSourceId(animeSourceId);
    }

    @PutMapping("/summary")
    public AnimeNote saveSummary(
            @PathVariable long animeSourceId,
            @Valid @RequestBody AnimeNoteRequest request) {
        return animeNoteService.saveSummary(animeSourceId, request);
    }

    @PutMapping("/episodes/{episodeNumber}")
    public AnimeNote saveEpisode(
            @PathVariable long animeSourceId,
            @PathVariable int episodeNumber,
            @Valid @RequestBody AnimeNoteRequest request) {
        return animeNoteService.saveEpisode(animeSourceId, episodeNumber, request);
    }

    @DeleteMapping("/episodes/{episodeNumber}")
    public void deleteEpisode(@PathVariable long animeSourceId, @PathVariable int episodeNumber) {
        animeNoteService.deleteEpisode(animeSourceId, episodeNumber);
    }
}
