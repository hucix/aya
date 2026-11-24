package io.liriliri.aya

import android.annotation.TargetApi
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.content.res.Configuration
import android.content.res.Resources
import android.net.LocalSocket
import android.os.Build
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.OutputStream

class Connection(private val client: LocalSocket) : Runnable {
    private companion object {
        private const val TAG = "Aya.Connection"
        private var packageCache = JSONObject()
        private const val ICON_CACHE_DIR = "/data/local/tmp/aya/icons"

        init {
            val iconCacheDir = File(ICON_CACHE_DIR)
            if (!iconCacheDir.exists()) {
                iconCacheDir.mkdirs()
            }
        }
    }

    override fun run() {
        // NOTE: do not use LocalSocket.isConnected as the loop condition.
        // On Android 5.x/6.x (:22/:23) a socket returned by LocalServerSocket.accept()
        // reports isConnected == false, so the old `while (!isInterrupted &&
        // client.isConnected)` loop body never ran and the connection was closed at once.
        Log.i(TAG, "Client connected, isConnected=${safeIsConnected()}")

        try {
            val input = client.inputStream
            val output = client.outputStream

            while (true) {
                val request = try {
                    Wire.Request.parseDelimitedFrom(input)
                } catch (t: Throwable) {
                    // Old Android/protobuf may surface errors as java.lang.Error
                    // (NoClassDefFoundError, VerifyError, ...), which `catch (e: Exception)`
                    // silently swallowed, killing the thread without any log.
                    Log.e(TAG, "Failed to read request", t)
                    break
                }

                if (request == null) {
                    Log.i(TAG, "Client closed connection (EOF)")
                    break
                }

                val params = if (request.params.isEmpty()) "{}" else request.params
                try {
                    handleRequest(request.id, request.method, params, output)
                } catch (t: Throwable) {
                    Log.e(TAG, "Failed to handle request", t)
                }
            }
        } catch (t: Throwable) {
            Log.e(TAG, "Connection failed", t)
        } finally {
            try {
                client.close()
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to close client", t)
            }
            Log.i(TAG, "Client disconnected")
        }
    }

    private fun safeIsConnected(): Boolean {
        return try {
            client.isConnected
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to read isConnected", t)
            false
        }
    }

    private fun handleRequest(id: String, method: String, params: String, output: OutputStream) {
        Log.i(TAG, "Request method: $method, params: $params")

        val result = JSONObject()

        when (method) {
            "getVersion" -> {
                result.put("version", getVersion())
            }

            "getPackageInfos" -> {
                result.put("packageInfos", getPackageInfos(JSONObject(params)))
            }

            "startFileServer" -> {
                val port = HttpFileServerManager.start()
                result.put("port", port)
            }

            "isFileServerRunning" -> {
                val running = HttpFileServerManager.isRunning()
                result.put("running", running)
            }

            else -> {
                Log.e(TAG, "Unknown method: $method")
            }
        }

        Log.i(TAG, "Response: $result")
        Wire.Response.newBuilder().setId(id).setResult(result.toString()).build()
            .writeDelimitedTo(output)
        output.flush()
        Log.i(TAG, "Response sent for $id")
    }

    private fun getVersion(): String {
        return BuildConfig.VERSION_NAME
    }

    private fun getPackageInfos(params: JSONObject): JSONArray {
        val packageNames = Util.jsonArrayToStringArray(params.getJSONArray("packageNames"))
        val result = JSONArray()

        packageNames.forEach {
            try {
                result.put(getPackageInfo(it))
            } catch (e: Exception) {
                Log.e(TAG, "Fail to get package info", e)
            }
        }

        return result
    }

    @TargetApi(Build.VERSION_CODES.P)
    private fun getPackageInfo(packageName: String): JSONObject {
        var flags = PackageManager.GET_ACTIVITIES
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            flags = flags or PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            flags = flags or PackageManager.GET_SIGNATURES
        }
        val packageInfo =
            ServiceManager.packageManager.getPackageInfo(packageName, flags)

        val info = JSONObject()
        info.put("packageName", packageInfo.packageName)
        info.put("versionName", packageInfo.versionName)
        info.put("firstInstallTime", packageInfo.firstInstallTime)
        info.put("lastUpdateTime", packageInfo.lastUpdateTime)
        info.put("signatures", getSignatures(packageInfo))

        val applicationInfo = packageInfo.applicationInfo
        var apkSize = 0L
        val apkPath = applicationInfo.sourceDir
        apkSize = File(apkPath).length()
        info.put("apkPath", apkPath)
        info.put("apkSize", apkSize)
        info.put("enabled", applicationInfo.enabled)

        var system = false
        if ((applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) == ApplicationInfo.FLAG_SYSTEM) {
            system = true
        }
        info.put("system", system)

        var label = packageName

        val cacheKey = "$packageName.$apkSize"
        var icon = ""

        if (packageCache.has(cacheKey)) {
            val cacheInfo = packageCache.getJSONObject(cacheKey)
            label = cacheInfo.getString("label")
            icon = cacheInfo.getString("icon")
        } else {
            val resources = getResources(apkPath)
            val labelRes = applicationInfo.labelRes
            if (labelRes != 0) {
                try {
                    label = resources.getString(labelRes)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to get label for $packageName")
                }
            }

            if (applicationInfo.icon != 0) {
                try {
                    icon = "$ICON_CACHE_DIR/$cacheKey.png"
                    val file = File(icon)
                    if (!file.exists()) {
                        val resIcon = resources.getDrawable(applicationInfo.icon)
                        val bitmapIcon = Util.drawableToBitmap(resIcon)
                        val pngIcon = Util.bitMapToPng(bitmapIcon, 20)
                        file.writeBytes(pngIcon)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to get icon for $packageName")
                }
            }
            val cacheInfo = JSONObject()
            cacheInfo.put("label", label)
            cacheInfo.put("icon", icon)
            packageCache.put(cacheKey, cacheInfo)
        }
        info.put("label", label)
        info.put("icon", icon)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            info.put("minSdkVersion", applicationInfo.minSdkVersion)
            info.put("targetSdkVersion", applicationInfo.targetSdkVersion)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                val stats = ServiceManager.storageStatsManager.queryStatsForPackage(
                    packageName
                )
                info.put("appSize", stats.appBytes)
                info.put("dataSize", stats.dataBytes)
                info.put("cacheSize", stats.cacheBytes)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to get storage stats for $packageName", e)
            }
        }

        return info
    }

    private fun getResources(apkPath: String): Resources {
        val assetManager = AssetManager::class.java.newInstance() as AssetManager
        val addAssetManagerMethod =
            assetManager.javaClass.getMethod("addAssetPath", String::class.java)
        addAssetManagerMethod.invoke(assetManager, apkPath)

        val displayMetrics = DisplayMetrics()
        displayMetrics.setToDefaults()
        val configuration = Configuration()
        configuration.setToDefaults()

        return Resources(assetManager, displayMetrics, configuration)
    }

    private fun getSignatures(packageInfo: PackageInfo): JSONArray {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.signingInfo.apkContentsSigners
        } else {
            packageInfo.signatures
        }

        val array = JSONArray()
        signatures.forEach {
            array.put(Base64.encodeToString(it.toByteArray(), Base64.NO_WRAP))
        }
        return array
    }
}
