package com.mktr.adplayer

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.ui.graphics.asImageBitmap
import dagger.hilt.android.AndroidEntryPoint
import com.mktr.adplayer.worker.WatchdogService


@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Start WatchdogService to ensure app restarts if it crashes
        startWatchdogService()
        
        // Hide System Bars (Immersive Sticky Mode)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
        controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        // Keep Screen On
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        
        // Kiosk Mode: Attempt to lock task (requires Device Owner or Screen Pinning)
        // REMOVED: startLockTask() calls to allow standard navigation.

        // Auto-request Location Permission for Fleet Tracking
        requestLocationPermission()

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MainScreen()
                }
            }
        }
    }

    private fun startWatchdogService() {
        try {
            val serviceIntent = Intent(this, WatchdogService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            Log.d(TAG, "WatchdogService started from MainActivity")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start WatchdogService: ${e.message}")
        }
    }

    private fun requestLocationPermission() {
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                this,
                android.Manifest.permission.ACCESS_FINE_LOCATION
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            Log.d(TAG, "Requesting location permission for fleet tracking")
            androidx.core.app.ActivityCompat.requestPermissions(
                this,
                arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION),
                LOCATION_PERMISSION_REQUEST_CODE
            )
        } else {
            Log.d(TAG, "Location permission already granted")
        }
    }

    companion object {
        private const val TAG = "AdPlayer.MainActivity"
        private const val LOCATION_PERMISSION_REQUEST_CODE = 1001
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
            ProvisioningScreen(
                state = s,
                onSave = { viewModel.saveDeviceKey(it) }
            )
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
fun ProvisioningScreen(state: UiState.Provisioning, onSave: (String) -> Unit) {
    var key by remember { mutableStateOf("") }
    
    // Status color
    val statusColor = if (state.status.contains("Error")) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary

    Row(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically
    ) {

        // Left Side: QR Code
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
             if (state.provisionUrl != null) {
                 QrCodeImage(
                     data = state.provisionUrl,
                     modifier = Modifier.size(300.dp)
                 )
                 Spacer(modifier = Modifier.height(16.dp))
                 Text(state.status, color = statusColor, style = MaterialTheme.typography.titleMedium)
             } else {
                 CircularProgressIndicator()
                 Spacer(modifier = Modifier.height(16.dp))
                 Text("Initializing Provisioning...", style = MaterialTheme.typography.bodyLarge)
             }
        }

        // Right Side: Manual Fallback
        Card(modifier = Modifier.width(400.dp)) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text("Manual Provisioning", style = MaterialTheme.typography.headlineSmall)
                Spacer(modifier = Modifier.height(16.dp))
                Text("Scan the QR code with the Admin Dashboard to automatically pair.", textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Spacer(modifier = Modifier.height(24.dp))
                Text("Or enter Device Key manually:", style = MaterialTheme.typography.labelMedium)
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
                    enabled = key.isNotBlank(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Save & Connect")
                }
            }
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

@Composable
fun QrCodeImage(data: String, modifier: Modifier = Modifier) {
    val bitmap = remember(data) {
        try {
            val writer = com.google.zxing.qrcode.QRCodeWriter()
            val bitMatrix = writer.encode(data, com.google.zxing.BarcodeFormat.QR_CODE, 512, 512)
            val width = bitMatrix.width
            val height = bitMatrix.height
            val bmp = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.RGB_565)
            for (x in 0 until width) {
                for (y in 0 until height) {
                    bmp.setPixel(x, y, if (bitMatrix.get(x, y)) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
                }
            }
            bmp.asImageBitmap()
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }


    if (bitmap != null) {
        androidx.compose.foundation.Image(
            bitmap = bitmap, 
            contentDescription = "Provisioning QR Code", 
            modifier = modifier
        )
    }
}

