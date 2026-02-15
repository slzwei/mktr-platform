package com.mktr.platform.v2

import android.net.Uri
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView

@OptIn(UnstableApi::class)
@Composable
fun VideoPlayer(
    modifier: Modifier = Modifier,
    playWhenReady: Boolean = true,
    videoUrl: String = "https://dooh-backend.onrender.com/trailer.mp4" // Production Render Video
) {
    val context = LocalContext.current

    val exoPlayer = remember(videoUrl) {
        Log.d("VideoPlayer", "Initializing player with URL: $videoUrl")
        
        // Simpler setup - let ExoPlayer handle the networking default
        val mediaItem = MediaItem.fromUri(Uri.parse(videoUrl))

        ExoPlayer.Builder(context).build().apply {
            repeatMode = Player.REPEAT_MODE_ALL
            setMediaItem(mediaItem)
            prepare()
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    when (playbackState) {
                        Player.STATE_IDLE -> Log.d("VideoPlayer", "State: IDLE")
                        Player.STATE_BUFFERING -> Log.d("VideoPlayer", "State: BUFFERING")
                        Player.STATE_READY -> Log.d("VideoPlayer", "State: READY")
                        Player.STATE_ENDED -> Log.d("VideoPlayer", "State: ENDED")
                    }
                }
                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    Log.e("VideoPlayer", "ExoPlayer Error: ${error.message}", error)
                }
            })
        }
    }

    // React to play/pause state changes
    LaunchedEffect(playWhenReady) {
        Log.d("VideoPlayer", "PlayWhenReady changed to: $playWhenReady")
        exoPlayer.playWhenReady = playWhenReady
    }

    DisposableEffect(Unit) {
        onDispose {
            exoPlayer.release()
        }
    }

    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = {
            PlayerView(context).apply {
                player = exoPlayer
                useController = false // Hide controls for DOOH
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            }
        }
    )
}
