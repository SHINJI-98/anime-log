package com.animelog.note;

import javax.validation.constraints.NotNull;

public class AnimeNoteRequest {
    @NotNull
    private String content = "";

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }
}
