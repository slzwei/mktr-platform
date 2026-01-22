package com.mktr.adplayer

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Hide System Bars (Immersive Sticky Mode)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
        controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        // Keep Screen On
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        
        // Kiosk Mode: Attempt to lock task (requires Device Owner or Screen Pinning)
        try {
            startLockTask()
        } catch (e: Exception) {
            // Fails if not whitelisted device owner or user hasn't approved pinning
            // We ignore for now; user must run adb command or pin manually
        }

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MainScreen()
                }
            }
        }
    }
}

@Composable
fun MainScreen(viewModel: MainViewModel = viewModel()) {
    val state by viewModel.uiState.collectAsState()
    var showPlayer by remember { mutableStateOf(true) }

    if (showPlayer && state is UiState.Connected) {
        val manifest = (state as UiState.Connected).manifest
        if (manifest != null && manifest.playlist.isNotEmpty()) {
            com.mktr.adplayer.ui.player.PlayerOrchestrator(manifest = manifest)
             // Back button to exit? For kiosk mode usually no back.
             // We can simulate a hidden exit for development.
             return
        }
    }

    when (val s = state) {
        is UiState.Loading -> {
             Box(contentAlignment = Alignment.Center) {
                 CircularProgressIndicator()
             }
        }
        is UiState.Provisioning -> {
            ProvisioningScreen(onSave = { viewModel.saveDeviceKey(it) })
        }
        is UiState.Connected -> {
            DashboardScreen(
                message = s.message,
                manifest = s.manifest,
                onRefresh = { viewModel.fetchManifest() },
                onReset = { viewModel.clearKey() },
                onPlay = { showPlayer = true }
            )
        }
        is UiState.Error -> {
            ErrorScreen(
                error = s.error,
                onRetry = { viewModel.fetchManifest() },
                onReset = { viewModel.clearKey() }
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProvisioningScreen(onSave: (String) -> Unit) {
    var key by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Device Provisioning", style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(16.dp))
        Text("Enter X-Device-Key to register this tablet:")
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = key,
            onValueChange = { key = it },
            label = { Text("Device Key") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = { onSave(key) },
            enabled = key.isNotBlank()
        ) {
            Text("Save & Connect")
        }
    }
}

@Composable
fun DashboardScreen(
    message: String, 
    manifest: com.mktr.adplayer.api.model.ManifestResponse?, 
    onRefresh: () -> Unit,
    onReset: () -> Unit,
    onPlay: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("AdPlayer Status", style = MaterialTheme.typography.titleLarge)
        Spacer(modifier = Modifier.height(16.dp))
        
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(message, style = MaterialTheme.typography.bodyLarge)
                Spacer(modifier = Modifier.height(8.dp))
                if (manifest != null) {
                    Text("Device ID: ${manifest.deviceId}")
                    Text("Refresh: ${manifest.refreshSeconds}s")
                    Text("Assets: ${manifest.assets.size}")
                    Text("Playlist: ${manifest.playlist.size} items")
                    
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(
                        onClick = onPlay,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = manifest.playlist.isNotEmpty()
                    ) {
                        Text("START PLAYER")
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Button(onClick = onRefresh) { Text("Force Refresh") }
            OutlinedButton(onClick = onReset) { Text("Reset Key") }
        }
    }
}

@Composable
fun ErrorScreen(error: String, onRetry: () -> Unit, onReset: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Connection Failed", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.titleMedium)
        Spacer(modifier = Modifier.height(8.dp))
        Text(error, style = MaterialTheme.typography.bodyMedium)
        Spacer(modifier = Modifier.height(16.dp))
        Button(onClick = onRetry) { Text("Retry") }
        TextButton(onClick = onReset) { Text("Change Key") }
    }
}
