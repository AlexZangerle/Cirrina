package at.ac.uibk.dps.cirrina.cirrina

import com.fasterxml.jackson.databind.ObjectMapper
import io.javalin.Javalin
import io.javalin.http.staticfiles.Location

class VisualizationServer(private val runtime: Runtime) {
  private val objectMapper = ObjectMapper()

  fun start() {
    val app =
      Javalin.create { config ->
          config.staticFiles.add { staticFileConfig ->
            staticFileConfig.directory = "/public"
            staticFileConfig.location = Location.CLASSPATH
          }
        }
        .start(7070)

    app.get("/visual") { ctx ->
      val statusData = buildCompatibleJson()
      ctx.json(statusData)
    }
  }

  private fun buildCompatibleJson(): Map<String, Any> {
    val nodes = mutableListOf<Map<String, Any>>()
    val links = mutableListOf<Map<String, Any>>()

    for (sm in runtime.stateMachines) {
      nodes.add(mapOf("id" to sm.id, "label" to sm.stateMachineClass.name, "group" to "instance"))
      for (state in sm.stateMachineClass.vertexSet()) {
        var isActive = false
        if (sm.activeState.stateObject.name != null) {
          isActive = state.name == sm.activeState.stateObject.name
        }

        val nodeId = "$sm.Id::${state.name}"

        val nodeData =
          mutableMapOf<String, Any>(
            "id" to nodeId,
            "label" to state.name,
            "group" to "state",
            "isActive" to isActive,
          )
        if (isActive) {
          nodeData["context"] = sm.extent.all.associate { it.name to it.value.toString() }
        }
        nodes.add(nodeData)
        links.add(mapOf("source" to sm.id, "target" to nodeId, "type" to "contains"))
      }
    }
    return mapOf("nodes" to nodes, "links" to links)
  }
}
