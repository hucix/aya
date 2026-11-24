package io.liriliri.aya

import android.net.LocalServerSocket
import android.util.Log
import java.util.concurrent.Executors

class Server {
    companion object {
        private const val TAG = "Aya.Server"

        @JvmStatic
        fun main(args: Array<String>) {
            try {
                Server().start(args)
            } catch (t: Throwable) {
                // Catch Throwable: old Android runtimes may throw Error subclasses
                // (NoClassDefFoundError / VerifyError) which `catch (e: Exception)` missed.
                Log.e(TAG, "Fail to start server", t)
            }
        }
    }

    private val executor = Executors.newCachedThreadPool()

    fun start(args: Array<String>) {
        Log.i(TAG, "Start server, version ${BuildConfig.VERSION_NAME}, sdk ${android.os.Build.VERSION.SDK_INT}")

        val server = LocalServerSocket("aya")
        Log.i(TAG, "Server started, listening on ${server.localSocketAddress}")

        while (true) {
            val client = try {
                server.accept()
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to accept client", t)
                continue
            }
            Log.i(TAG, "Client connected")
            executor.submit(Connection(client))
        }
    }
}
