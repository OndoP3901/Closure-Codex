use std::{
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{ipc::Channel, State, WebviewWindow};

const INTERVAL: Duration = Duration::from_millis(24);
const REPLY_LIMIT: Duration = Duration::from_millis(220);

#[derive(Clone, Default)]
pub struct Cursor(Arc<Mutex<CursorState>>);

#[derive(Default)]
struct CursorState {
    next_sequence: u32,
    pending: Option<(u32, Instant)>,
    reply: Option<bool>,
    generation: u32,
}

#[derive(Clone, Serialize)]
pub struct Sample {
    x: f64,
    y: f64,
    sequence: u32,
}

#[tauri::command]
pub fn cursor_result(cursor: State<'_, Cursor>, sequence: u32, interactive: bool) {
    let mut state = cursor.0.lock().unwrap();
    if let Some((pending, sent)) = state.pending {
        if sequence == pending {
            state.pending = None;
            state.reply = Some(interactive && sent.elapsed() < REPLY_LIMIT);
        }
    }
}

impl Cursor {
    pub fn start(&self, window: WebviewWindow, channel: Channel<Sample>) {
        let mut state = self.0.lock().unwrap();
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        state.pending = None;
        state.reply = None;
        drop(state);
        let state = self.0.clone();
        thread::spawn(move || {
            let mut interactive = false;
            loop {
                let Ok(visible) = window.is_visible() else {
                    break;
                };
                if !visible {
                    thread::sleep(INTERVAL);
                    continue;
                }
                let (reply, can_sample) = {
                    let mut state = state.lock().unwrap();
                    if state.generation != generation {
                        return;
                    }
                    let stale = state
                        .pending
                        .is_some_and(|(_, sent)| sent.elapsed() >= REPLY_LIMIT);
                    let reply = state.reply.take();
                    (
                        if stale { Some(false) } else { reply },
                        state.pending.is_none(),
                    )
                };
                if let Some(reply) = reply {
                    if reply != interactive {
                        if window.set_ignore_cursor_events(!reply).is_err() {
                            break;
                        }
                        interactive = reply;
                    }
                }
                if can_sample {
                    if let (Ok(point), Ok(origin), Ok(scale)) = (
                        window.cursor_position(),
                        window.inner_position(),
                        window.scale_factor(),
                    ) {
                        let mut state = state.lock().unwrap();
                        if state.generation != generation {
                            return;
                        }
                        let sequence = state.next_sequence;
                        state.next_sequence = state.next_sequence.wrapping_add(1);
                        state.pending = Some((sequence, Instant::now()));
                        drop(state);
                        if channel
                            .send(Sample {
                                x: (point.x - f64::from(origin.x)) / scale,
                                y: (point.y - f64::from(origin.y)) / scale,
                                sequence,
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                }
                thread::sleep(INTERVAL);
            }
            if state.lock().unwrap().generation == generation {
                let _ = window.set_ignore_cursor_events(true);
            }
        });
    }
}
