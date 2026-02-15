package com.mktr.platform.v2

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Initialize with Context
        SocketManager.init(applicationContext)

        setContent {
            MaterialTheme {
                MainScreen()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        SocketManager.disconnect()
    }
}

@Composable
fun MainScreen() {
    val lastCommand by SocketManager.lastCommand.collectAsState()
    val connectionState by SocketManager.connectionState.collectAsState()
    val isPlaying = lastCommand == "PLAY"
    
    // Hidden Menu State
    var showSettings by remember { mutableStateOf(false) }
    var tapCount by remember { mutableStateOf(0) }
    
    // Reset tap count after delay
    LaunchedEffect(tapCount) {
        if (tapCount > 0) {
            kotlinx.coroutines.delay(2000)
            tapCount = 0
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        
        VideoPlayer(playWhenReady = isPlaying)

        // Status Overlay (Visible when not playing or disconnected)
        if (!isPlaying || connectionState != "Connected") {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.7f)),
                contentAlignment = Alignment.Center
            ) {
                SocketStatusScreen()
            }
        }
        
        // Hidden Settings Trigger (Top Left Corner)
        Box(
            modifier = Modifier
                .size(100.dp)
                .align(Alignment.TopStart)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) {
                    tapCount++
                    if (tapCount >= 5) { // 5 taps to open
                        showSettings = true
                        tapCount = 0
                    }
                }
        )
        
        if (showSettings) {
            SettingsDialog(onDismiss = { showSettings = false })
        }
    }
}

@Composable
fun SettingsDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { PrefsStore(context) }
    
    var currentUrl by remember { mutableStateOf("") }
    
    LaunchedEffect(Unit) {
        prefs.backendUrlFlow.collect { currentUrl = it }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Admin Settings") },
        text = {
            Column {
                Text("Backend URL:", style = MaterialTheme.typography.labelMedium)
                OutlinedTextField(
                    value = currentUrl,
                    onValueChange = { currentUrl = it },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = {
                        scope.launch {
                            prefs.setBackendUrl(currentUrl)
                            SocketManager.disconnect()
                            SocketManager.connect() // Reconnect with new URL
                            Toast.makeText(context, "URL Updated", Toast.LENGTH_SHORT).show()
                            onDismiss()
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Save & Reconnect")
                }
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = {
                        scope.launch {
                            prefs.resetDeviceId()
                            // Restart app or re-init?
                            // Simple re-init for now
                            SocketManager.disconnect()
                            SocketManager.connect()
                            Toast.makeText(context, "Device ID Reset", Toast.LENGTH_SHORT).show()
                            onDismiss()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Reset Device ID")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        }
    )
}

@Composable
fun SocketStatusScreen() {
    val status by SocketManager.connectionState.collectAsState()
    val lastCommand by SocketManager.lastCommand.collectAsState()
    val deviceId by SocketManager.currentDeviceId.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "MKTR Platform V2",
            style = MaterialTheme.typography.headlineMedium,
            color = Color.White
        )
        
        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "ID: $deviceId",
            style = MaterialTheme.typography.bodySmall,
            color = Color.Gray
        )
        
        Spacer(modifier = Modifier.height(32.dp))

        Text(
            text = "Status: $status",
            style = MaterialTheme.typography.bodyLarge,
            color = if (status == "Connected") Color.Green else Color.Red
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Last Command:",
            style = MaterialTheme.typography.titleMedium,
            color = Color.White
        )
        
        Text(
            text = lastCommand ?: "None",
            style = MaterialTheme.typography.headlineSmall,
            color = Color.White
        )
        
        Spacer(modifier = Modifier.height(32.dp))
        Text("(Tap top-left 5x for Settings)", color = Color.DarkGray, style = MaterialTheme.typography.labelSmall)
    }
}
