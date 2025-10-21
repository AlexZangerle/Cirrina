package at.ac.uibk.dps.cirrina.cirrina

import at.ac.uibk.dps.cirrina.classes.transition.OnTransitionClass
import at.ac.uibk.dps.cirrina.execution.`object`.action.InvokeAction
import at.ac.uibk.dps.cirrina.execution.`object`.action.RaiseAction
import at.ac.uibk.dps.cirrina.execution.`object`.statemachine.StateMachine
import com.fasterxml.jackson.databind.ObjectMapper
import io.javalin.Javalin
import io.javalin.http.staticfiles.Location
import io.javalin.websocket.WsContext
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

class VisualizationServer(private val runtime: Runtime) : InvocationListener {
  private val objectMapper = ObjectMapper()
  private val userSessions = ConcurrentHashMap<WsContext, String>()

  fun start() {
    val app =
      Javalin.create { config ->
          config.staticFiles.add { staticFileConfig ->
            staticFileConfig.directory = "/public/dist"
            staticFileConfig.location = Location.CLASSPATH
          }
        }
        .start(7070)

    app.ws("/visual-socket") { ws ->
      ws.onConnect { ctx -> userSessions[ctx] = "user" }
      ws.onClose { ctx -> userSessions.remove(ctx) }
    }
    runtime.addInvocationListener(this)
    startUpdateThread()
  }

  private fun startUpdateThread() {
    thread(isDaemon = true) {
      while (true) {
        if (userSessions.isNotEmpty()) {
          try {
            userSessions.keys.forEach {
              it.send(
                objectMapper.writeValueAsString(
                  mapOf("type" to "statusUpdate", "payload" to buildJson())
                )
              )
            }
          } catch (e: Exception) {
            println("Error broadcasting data ${e.message}")
          }
        }
        Thread.sleep(250)
      }
    }
  }

  private fun buildJson(): Map<String, Any> {
    val nodes = mutableListOf<Map<String, Any>>()
    val links = mutableListOf<Map<String, Any>>()
    val allServiceTypes = mutableSetOf<String>()
    var raisedEvents = mutableListOf<Map<String, Any>>()
    val stateMachineInstances = runtime.stateMachines
    if (stateMachineInstances.isEmpty()) {
      return mapOf("nodes" to emptyList<Any>(), "links" to emptyList<Any>())
    }

    for (sm in stateMachineInstances) {
      val smId = sm.stateMachineInstanceId.toString()
      val smName = sm.stateMachineClass.name
      val currentState = sm.activeState
      val currentStateName = currentState?.stateObject?.name

      nodes.add(mapOf("id" to smId, "label" to smName, "group" to "instance"))

      for (state in sm.stateMachineClass.vertexSet()) {
        val isActive = state.name == currentStateName
        val nodeId = "$smId::${state.name}"
        val nodeData =
          mutableMapOf<String, Any>(
            "id" to nodeId,
            "label" to state.name,
            "group" to "state",
            "isActive" to isActive,
            "isTerminal" to state.isTerminal,
          )
        if (isActive && sm.extent != null) {
          nodeData["context"] = sm.extent.all.associate { it.name() to it.value().toString() }
        }
        nodes.add(nodeData)
      }

      val invokeActionClass = InvokeAction::class.java as Class<InvokeAction>
      sm.stateMachineClass.vertexSet().forEach { state ->
        state.getActionsOfType(invokeActionClass).forEach { allServiceTypes.add(it.serviceType) }
      }
      sm.stateMachineClass.edgeSet().forEach { transition ->
        transition.getActionsOfType(invokeActionClass).forEach {
          allServiceTypes.add(it.serviceType)
        }
      }
    }

    allServiceTypes.forEach { serviceName ->
      nodes.add(
        mapOf("id" to "service::$serviceName", "label" to serviceName, "group" to "service")
      )
    }

    for (sm in stateMachineInstances) {
      val smId = sm.stateMachineInstanceId.toString()

      sm.stateMachineClass.vertexSet().forEach { state ->
        if (state.isInitial) {
          links.add(
            mapOf("source" to smId, "target" to "$smId::${state.name}", "type" to "contains")
          )
        }
      }
      if (sm.parentStateMachine != null) {

        links.add(
          mapOf(
            "source" to sm.parentStateMachine.stateMachineInstanceId.toString(),
            "target" to smId,
            "type" to "nested",
          )
        )
      }

      sm.stateMachineClass.edgeSet().forEach { transition ->
        val sourceState = sm.stateMachineClass.getEdgeSource(transition)
        val targetState = sm.stateMachineClass.getEdgeTarget(transition)
        if (sourceState != null && targetState != null) {
          links.add(
            mapOf(
              "source" to "$smId::${sourceState.name}",
              "target" to "$smId::${targetState.name}",
              "type" to "transition",
            )
          )
        }
      }

      val invokeActionClass = InvokeAction::class.java as Class<InvokeAction>
      sm.stateMachineClass.edgeSet().forEach { transition ->
        val sourceState = sm.stateMachineClass.getEdgeSource(transition)
        if (sourceState != null) {
          transition.getActionsOfType(invokeActionClass).forEach { action ->
            links.add(
              mapOf(
                "source" to "$smId::${sourceState.name}",
                "target" to "service::${action.serviceType}",
                "type" to "invokes",
              )
            )
          }
        }
      }

      sm.stateMachineClass.vertexSet().forEach { state ->
        state.getActionsOfType(invokeActionClass).forEach { action ->
          links.add(
            mapOf(
              "source" to "$smId::${state.name}",
              "target" to "service::${action.serviceType}",
              "type" to "invokes",
            )
          )
        }
        state.getActionsOfType(RaiseAction::class.java).forEach { action ->
          raisedEvents.add(mapOf("raisingMachine" to smId, "event" to action.event.name))
        }
      }
    }
    for (sm in stateMachineInstances) {
      var onTransitions = mutableListOf<OnTransitionClass?>()
      sm.stateMachineClass.vertexSet().forEach { state ->
        for (transition in sm.stateMachineClass.findOnTransitionsFromState(state)) {
          onTransitions.add(transition)
        }
      }
      val smId = sm.stateMachineInstanceId.toString()
      onTransitions.forEach { transition ->
        raisedEvents
          .filter { it["event"] == transition?.eventName }
          .forEach { raise ->
            links.add(
              mapOf<String, Any>(
                "source" to raise["raisingMachine"] as String,
                "target" to smId,
                "event" to raise["event"] as String,
                "type" to "event-link",
              )
            )
          }
      }
    }
    links.toSet()
    return mapOf("nodes" to nodes, "links" to links)
  }

  override fun onServiceInvoked(sm: StateMachine, serviceType: String) {
    val sourceState = sm.activeState ?: return
    val sourceId = "${sm.stateMachineInstanceId}::${sourceState.stateObject.name}"
    userSessions.keys.forEach {
      it.send(
        objectMapper.writeValueAsString(
          mapOf(
            "type" to "invocation",
            "payload" to mapOf("sourceId" to sourceId, "targetId" to "service::$serviceType"),
          )
        )
      )
    }
  }
}
