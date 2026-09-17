package com.animelog.anime;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AnimeController {
    private final AnimeService animeService;
    private final SeasonService seasonService;

    public AnimeController(AnimeService animeService, SeasonService seasonService) {
        this.animeService = animeService;
        this.seasonService = seasonService;
    }

    @GetMapping("/seasons/current")
    public Map<String, String> currentSeason() {
        String current = seasonService.currentSeason();
        Map<String, String> response = new HashMap<String, String>();
        response.put("season", current);
        response.put("previousSeason", seasonService.previousSeason(current));
        response.put("nextSeason", seasonService.nextSeason(current));
        return response;
    }

    @GetMapping("/anime")
    public List<AnimeSource> listAnime(@RequestParam String season) {
        return animeService.listSeason(season);
    }

    @PostMapping("/anime/refresh")
    public List<AnimeSource> refreshAnime(@RequestParam String season) {
        return animeService.refresh(season);
    }
}
