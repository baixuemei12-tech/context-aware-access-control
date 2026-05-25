package org.example.gateway.controller;

import org.example.gateway.model.User;
import org.example.gateway.service.LiveEventService;
import org.example.gateway.service.UserService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/events")
public class LiveEventController {

    private final UserService userService;
    private final LiveEventService liveEventService;

    public LiveEventController(UserService userService, LiveEventService liveEventService) {
        this.userService = userService;
        this.liveEventService = liveEventService;
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> stream(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(liveEventService.subscribe(user));
    }
}
