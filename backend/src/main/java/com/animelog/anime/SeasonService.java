package com.animelog.anime;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

import org.springframework.stereotype.Service;

@Service
public class SeasonService {
    public String currentSeason() {
        LocalDate today = LocalDate.now();
        LocalDate nextQuarter = nextQuarterStart(today);
        if (!today.isBefore(nextQuarter.minusDays(14)) && today.isBefore(nextQuarter)) {
            return seasonFor(nextQuarter);
        }
        return seasonFor(today);
    }

    public String previousSeason(String season) {
        return shiftSeason(season, -3);
    }

    public String nextSeason(String season) {
        return shiftSeason(season, 3);
    }

    private String shiftSeason(String season, int months) {
        LocalDate date = LocalDate.parse(season + "01", DateTimeFormatter.BASIC_ISO_DATE);
        return seasonFor(date.plusMonths(months));
    }

    private String seasonFor(LocalDate date) {
        int month = date.getMonthValue();
        int seasonMonth;
        if (month <= 3) {
            seasonMonth = 1;
        } else if (month <= 6) {
            seasonMonth = 4;
        } else if (month <= 9) {
            seasonMonth = 7;
        } else {
            seasonMonth = 10;
        }
        return String.format("%04d%02d", date.getYear(), seasonMonth);
    }

    private LocalDate nextQuarterStart(LocalDate date) {
        int month = date.getMonthValue();
        int nextMonth;
        int year = date.getYear();
        if (month < 4) {
            nextMonth = 4;
        } else if (month < 7) {
            nextMonth = 7;
        } else if (month < 10) {
            nextMonth = 10;
        } else {
            nextMonth = 1;
            year += 1;
        }
        return LocalDate.of(year, nextMonth, 1);
    }
}
