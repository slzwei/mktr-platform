package com.mktr.adplayer.ui.player

import android.net.Uri
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil.compose.rememberAsyncImagePainter
import com.mktr.adplayer.api.model.ManifestResponse

@Composable
fun PlayerOrchestrator(
    manifest: ManifestResponse,
    viewModel: PlayerViewModel = hiltViewModel()
) {
    LaunchedEffect(manifest) {
        viewModel.startPlaylist(manifest)
    }

    val state by viewModel.playerState.collectAsState()

    when (val s = state) {
        is PlayerState.Initializing -> {
            Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Color.White)
                    Spacer(Modifier.height(16.dp))
                    Text("Downloading Assets...", color = Color.White)
                }
            }
        }
        is PlayerState.Playing -> {
            PlayerContent(state = s)
        }
        is PlayerState.Error -> {
            Box(Modifier.fillMaxSize().background(Color.Red), contentAlignment = Alignment.Center) {
                Text("Playback Error: ${s.message}", color = Color.White)
            }
        }
    }
}

@Composable
fun PlayerContent(state: PlayerState.Playing) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (state.item.type == "video") {
            VideoPlayer(uri = state.fileUri, playId = state.playId)
        } else {
            ImagePlayer(uri = state.fileUri)
        }
        
        // Debug Overlay
        Text(
            text = "${state.index + 1}/${state.total} | ${state.item.type}",
            color = Color.Yellow,
            modifier = Modifier.align(Alignment.TopStart).padding(16.dp),
            style = MaterialTheme.typography.labelSmall
        )
    }
}

@Composable
fun ImagePlayer(uri: Uri) {
    Image(
        painter = rememberAsyncImagePainter(uri),
        contentDescription = null,
        modifier = Modifier.fillMaxSize(),
        contentScale = ContentScale.Crop
    )
}

@kotlin.OptIn(UnstableApi::class)
@Composable
fun VideoPlayer(uri: Uri, playId: Long) {
    val context = LocalContext.current
    
    // Remember ExoPlayer instance to survive recompositions but NOT config changes (VM handles that usually, 
    // but here we want simple lifecycle). Dispose on exit.
    val exoPlayer = remember {
        ExoPlayer.Builder(context).build().apply {
            playWhenReady = true
            repeatMode = Player.REPEAT_MODE_OFF // VM controls loop
        }
    }

    // Update media item when URI or playId changes
    LaunchedEffect(uri, playId) {
        val mediaItem = MediaItem.fromUri(uri)
        exoPlayer.setMediaItem(mediaItem)
        exoPlayer.prepare()
        exoPlayer.play()
    }

    DisposableEffect(Unit) {
        onDispose {
            exoPlayer.release()
        }
    }

    AndroidView(
        factory = {
            PlayerView(context).apply {
                player = exoPlayer
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            }
        },
        modifier = Modifier.fillMaxSize()
    )
}
