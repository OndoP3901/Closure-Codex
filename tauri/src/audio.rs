use std::{
    io::Cursor,
    sync::mpsc::{self, SyncSender},
    thread,
};

use lewton::inside_ogg::OggStreamReader;
use rodio::{buffer::SamplesBuffer, OutputStream, OutputStreamBuilder, Sink};
use tauri::{AppHandle, State};
use tokio::sync::oneshot;

pub struct Audio(SyncSender<Command>);

enum Command {
    Play {
        path: String,
        volume: f32,
        request: u64,
        result: oneshot::Sender<Result<f64, String>>,
    },
    Stop(u64),
    Volume(u64, f32),
}

#[derive(Default)]
struct Player {
    stream: Option<OutputStream>,
    playing: Option<Sink>,
    request: u64,
}

impl Player {
    fn stop(&mut self) {
        if let Some(playing) = self.playing.take() {
            playing.stop();
        }
    }

    fn play(&mut self, app: &AppHandle, path: &str, volume: f32) -> Result<f64, String> {
        let asset = app
            .asset_resolver()
            .get(path.into())
            .ok_or("语音文件不存在。")?;
        let mut decoder =
            OggStreamReader::new(Cursor::new(asset.bytes)).map_err(|error| error.to_string())?;
        let channels = decoder.ident_hdr.audio_channels.into();
        let rate = decoder.ident_hdr.audio_sample_rate;
        let mut samples = Vec::new();
        while let Some(packet) = decoder
            .read_dec_packet_itl()
            .map_err(|error| error.to_string())?
        {
            samples.extend(packet.into_iter().map(|sample| f32::from(sample) / 32768.0));
        }
        if samples.is_empty() {
            return Err("语音文件没有音频数据。".into());
        }
        let duration = samples.len() as f64 * 1000.0 / (f64::from(channels) * f64::from(rate));
        if self.stream.is_none() {
            self.stream = Some(
                OutputStreamBuilder::open_default_stream().map_err(|error| error.to_string())?,
            );
        }
        let sink = Sink::connect_new(self.stream.as_ref().unwrap().mixer());
        sink.set_volume(volume);
        sink.append(SamplesBuffer::new(channels, rate, samples));
        self.playing = Some(sink);
        Ok(duration)
    }
}

impl Audio {
    pub fn start(app: AppHandle) -> Self {
        let (sender, receiver) = mpsc::sync_channel(16);
        thread::spawn(move || {
            let mut player = Player::default();
            while let Ok(command) = receiver.recv() {
                match command {
                    Command::Play {
                        path,
                        volume,
                        request,
                        result,
                    } => {
                        let outcome = if request < player.request {
                            Err("语音已被替换。".into())
                        } else {
                            player.request = request;
                            player.stop();
                            player.play(&app, &path, volume)
                        };
                        let _ = result.send(outcome);
                    }
                    Command::Stop(request) if request > player.request => {
                        player.request = request;
                        player.stop();
                    }
                    Command::Volume(request, volume) if request == player.request => {
                        if let Some(playing) = &player.playing {
                            playing.set_volume(volume);
                        }
                    }
                    _ => {}
                }
            }
        });
        Self(sender)
    }

    fn send(&self, command: Command) -> Result<(), String> {
        self.0.try_send(command).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn play_voice(
    audio: State<'_, Audio>,
    language: String,
    id: String,
    volume: f32,
    request: u64,
) -> Result<f64, String> {
    if !matches!(language.as_str(), "zh" | "ja" | "en" | "ko")
        || id.is_empty()
        || id.len() > 32
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        || !volume.is_finite()
    {
        return Err("语音参数无效。".into());
    }
    let (result, finished) = oneshot::channel();
    audio.send(Command::Play {
        path: format!("dsh-closure/assets/audio/voice/{language}/{id}.ogg"),
        volume: volume.clamp(0.0, 1.0),
        request,
        result,
    })?;
    finished.await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn stop_voice(audio: State<'_, Audio>, request: u64) -> Result<(), String> {
    audio.send(Command::Stop(request))
}

#[tauri::command]
pub fn voice_volume(audio: State<'_, Audio>, volume: f32, request: u64) -> Result<(), String> {
    if !volume.is_finite() {
        return Err("音量无效。".into());
    }
    audio.send(Command::Volume(request, volume.clamp(0.0, 1.0)))
}
