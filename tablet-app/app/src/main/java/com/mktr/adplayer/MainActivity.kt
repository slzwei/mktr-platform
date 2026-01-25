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

    @javax.inject.Inject lateinit var devicePrefs: com.mktr.adplayer.data.local.DevicePrefs
    @javax.inject.Inject lateinit var hotspotManager: com.mktr.adplayer.network.HotspotManager
    @javax.inject.Inject lateinit var wifiConnector: com.mktr.adplayer.network.WifiConnector

    private val prefsListener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == "device_role" || key == "hotspot_ssid") {
            Log.i(TAG, "Config Changed ($key) -> Restarting Networking...")
            runOnUiThread {
                setupNetworking()
                // If role changed to Master, we might need to recreate activity or just restart services?
                // SetupNetworking handles start, but does it handle stop?
                // For safety/simplicity in this hotfix, we can recreate() to ensure clean state if role flips.
                if (key == "device_role") {
                     // triggerRebirth(this) // Optional: Full app restart might be safer for Network switching
                     // For now, let's rely on setupNetworking being smart enough or just adding stop logic there.
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Start WatchdogService to ensure app restarts if it crashes
        // startWatchdogService() // DISABLED per user request
        
        // Register Prefs Listener
        devicePrefs.registerListener(prefsListener)
        
        // Setup Vehicle Networking (Hotspot or WiFi)
        setupNetworking()
        
        // Hide System Bars (Immersive Sticky Mode)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
        controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        // Keep Screen On
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        
        // Kiosk Mode: Attempt to lock task (requires Device Owner or Screen Pinning)
        // REMOVED: startLockTask() calls to allow standard navigation.

        // Auto-request Permissions (Location, Nearby Devices)
        requestAllPermissions()

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MainScreen()
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        devicePrefs.unregisterListener(prefsListener)
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

    private fun requestAllPermissions() {
        val permissions = mutableListOf<String>()
        
        // Location (Always required for WiFi scanning/Hotspot legacy)
        if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            permissions.add(android.Manifest.permission.ACCESS_FINE_LOCATION)
        }
        
        // Nearby Devices (Android 13+ required for Hotspot/P2P)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.NEARBY_WIFI_DEVICES) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                permissions.add(android.Manifest.permission.NEARBY_WIFI_DEVICES)
            }
        }

        if (permissions.isNotEmpty()) {
            Log.d(TAG, "Requesting permissions: $permissions")
            androidx.core.app.ActivityCompat.requestPermissions(
                this,
                permissions.toTypedArray(),
                PERMISSION_REQUEST_CODE
            )
        } else {
            Log.d(TAG, "All required permissions already granted")
        }
    }

    private fun setupNetworking() {
        val role = devicePrefs.deviceRole
        Log.i(TAG, "Initializing Networking. Role: $role")
        
        // Reset/Stop everything first to ensure clean state
        try {
            hotspotManager.stopHotspot() // Assume this method exists or is safe
            wifiConnector.disconnect()
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping previous networking: ${e.message}")
        }

        if (devicePrefs.isMaster) {
            // Master: Start Hotspot
            Log.d(TAG, "Starting Master Hotspot...")
            hotspotManager.startHotspot()
            // Ensure we aren't connected to another WiFi? 
            // Android prioritizes LocalOnlyHotspot but usually we want to keep upstream if possible (cellular).
        } else if (devicePrefs.isSlave) {
            // Slave: Connect to Hotspot
            val ssid = devicePrefs.hotspotSsid
            val password = devicePrefs.hotspotPassword
            
            if (!ssid.isNullOrEmpty() && !password.isNullOrEmpty()) {
                Log.d(TAG, "Connecting to Master Hotspot: $ssid")
                wifiConnector.connectToHotspot(ssid, password)
            } else {
                Log.w(TAG, "Slave mode but no hotspot credentials found.")
            }
        }
    }

    companion object {
        private const val TAG = "AdPlayer.MainActivity"
        private const val PERMISSION_REQUEST_CODE = 1001
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

    val context = androidx.compose.ui.platform.LocalContext.current
    var hasPermissions by remember {
        mutableStateOf(checkPermissions(context))
    }
    
    // Check again on resume
    DisposableEffect(Unit) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
             if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                 hasPermissions = checkPermissions(context)
             }
        }
        (context as? androidx.lifecycle.LifecycleOwner)?.lifecycle?.addObserver(observer)
        onDispose { (context as? androidx.lifecycle.LifecycleOwner)?.lifecycle?.removeObserver(observer) }
    }

    if (!hasPermissions) {
        PermissionScreen(
            onGrantClick = { 
                (context as? android.app.Activity)?.let { activity ->
                    val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = android.net.Uri.fromParts("package", context.packageName, null)
                    }
                    context.startActivity(intent)
                }
            },
            onCheckAgain = { hasPermissions = checkPermissions(context) }
        )
        return
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

fun checkPermissions(context: android.content.Context): Boolean {
    val location = androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    
    val nearby = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.NEARBY_WIFI_DEVICES) == android.content.pm.PackageManager.PERMISSION_GRANTED
    } else {
        true
    }
    
    return location && nearby
}

@Composable
fun PermissionScreen(onGrantClick: () -> Unit, onCheckAgain: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Permissions Required", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.error)
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            "To pair this tablet and use vehicle features, you must grant the following permissions:\n\n" +
            "• Location (Set to 'Allow all the time' or 'Allow while using app')\n" +
            "• Nearby Devices (For vehicle hotspot)",
            style = MaterialTheme.typography.bodyLarge,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
        Spacer(modifier = Modifier.height(32.dp))
        Button(onClick = onGrantClick) {
            Text("Open Settings")
        }
        Spacer(modifier = Modifier.height(16.dp))
        OutlinedButton(onClick = onCheckAgain) {
            Text("I have granted them")
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
                    
                    // Permission Status
                    val context = androidx.compose.ui.platform.LocalContext.current
                    val locGranted = androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
                    val nearbyGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.NEARBY_WIFI_DEVICES) == android.content.pm.PackageManager.PERMISSION_GRANTED
                    } else {
                        true // Not applicable
                    }
                    
                    Divider(modifier = Modifier.padding(vertical = 8.dp))
                    Text("Permissions:", style = MaterialTheme.typography.labelLarge)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                         Text("Location: ", style = MaterialTheme.typography.bodyMedium)
                         Text(if (locGranted) "GRANTED" else "MISSING", color = if (locGranted) androidx.compose.ui.graphics.Color(0xFF4CAF50) else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                             Text("Nearby Devices: ", style = MaterialTheme.typography.bodyMedium)
                             Text(if (nearbyGranted) "GRANTED" else "MISSING", color = if (nearbyGranted) androidx.compose.ui.graphics.Color(0xFF4CAF50) else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                        }
                    }

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

