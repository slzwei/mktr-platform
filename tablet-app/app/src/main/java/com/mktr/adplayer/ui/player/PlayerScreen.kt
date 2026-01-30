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

    DisposableEffect(Unit) {
        onDispose {
            viewModel.stopPlayback()
        }
    }

    val state by viewModel.playerState.collectAsState()
    val isDownloading by viewModel.isDownloading.collectAsState()

    Box(Modifier.fillMaxSize()) {
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
            is PlayerState.WaitingForSync -> {
                Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "MKTR",
                            color = Color.DarkGray,
                            style = MaterialTheme.typography.displayLarge
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            text = "SYNCHRONIZING FLEET...",
                            color = Color.Gray,
                            style = MaterialTheme.typography.labelMedium
                        )
                    }
                }
            }
        }

        // Overlay Indicator (Top Right)
        if (isDownloading && state is PlayerState.Playing) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(16.dp)
                    .background(Color.Black.copy(alpha = 0.6f), shape = MaterialTheme.shapes.small)
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        color = Color.White,
                        strokeWidth = 2.dp
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = "Updating Content...",
                        color = Color.White,
                        style = MaterialTheme.typography.labelMedium
                    )
                }
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
        


        // Debug Overlay (Invisible - Structural Only)
        Text(
            text = "Idx: ${state.index + 1}/${state.total} | Type: ${state.item.type} | ID: ${state.item.id}\nDur: ${state.item.durationMs}ms",
            color = Color.Transparent,
            modifier = Modifier
                .align(Alignment.TopStart)
                .background(Color.Transparent)
                .padding(8.dp),
            style = MaterialTheme.typography.labelMedium
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
    
    // Use the Shared Player from ViewModel (accessed via Hilt/Parent)
    val viewModel: PlayerViewModel = hiltViewModel() 
    val exoPlayer = viewModel.exoPlayer

    // Setup Media Item
    LaunchedEffect(uri, playId) {
        val mediaItem = MediaItem.fromUri(uri)
        if (exoPlayer.currentMediaItem?.localConfiguration?.uri != uri) {
            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.prepare()
        }
        exoPlayer.play()
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
