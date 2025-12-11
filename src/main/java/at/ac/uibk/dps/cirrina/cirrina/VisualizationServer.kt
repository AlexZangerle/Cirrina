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

  // Store the hash of the last payload sent
  @Volatile private var lastBroadcastHash = 0

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
      ws.onConnect { ctx ->
        userSessions[ctx] = "user"
        try {
          ctx.send(
            objectMapper.writeValueAsString(
              mapOf("type" to "initialState", "payload" to buildJson())
            )
          )
        } catch (e: Exception) {
          println("Error sending initial state: ${e.message}")
        }
      }
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
            val newPayload = buildJson()
            val newHash = newPayload.hashCode()

            // Broadcast only if the hash has changed
            if (newHash != lastBroadcastHash) {
              lastBroadcastHash = newHash
              val message =
                objectMapper.writeValueAsString(
                  mapOf("type" to "statusUpdate", "payload" to newPayload)
                )
              userSessions.keys.forEach { it.send(message) }
            }
          } catch (e: Exception) {
            println("Error broadcasting data ${e.message}")
          }
        }
        Thread.sleep(250)
      }
    }
  }

  /** Build JSON used to send to the client */
  private fun buildJson(): Map<String, Any> {
    val stateMachineInstances = runtime.stateMachines
    if (stateMachineInstances.isEmpty()) {
      return mapOf("nodes" to emptyList<Any>(), "links" to emptyList<Any>())
    }

    val nodes = mutableListOf<Map<String, Any>>()
    val links = mutableSetOf<Map<String, Any>>()
    val allServiceTypes = mutableSetOf<String>()
    val raisedEvents = mutableListOf<Map<String, Any>>()
    val allOnTransitions = mutableListOf<Triple<String, OnTransitionClass?, StateMachine>>()
    val invokeActionClass = InvokeAction::class.java as Class<InvokeAction>
    val raiseActionClass = RaiseAction::class.java as Class<RaiseAction>

    for (sm in stateMachineInstances) {
      val smId = sm.stateMachineInstanceId.toString()
      val smName = sm.stateMachineClass.name
      val currentState = sm.activeState
      val currentStateName = currentState?.stateObject?.name

      // Add Instance Node
      nodes.add(mapOf("id" to smId, "label" to smName, "group" to "instance"))

      // Add Parent Link if one exists
      if (sm.parentStateMachine != null) {
        links.add(
          mapOf(
            "source" to sm.parentStateMachine.stateMachineInstanceId.toString(),
            "target" to smId,
            "type" to "nested",
          )
        )
      }

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
          nodeData["context"] =
            currentState.extent.all.associate { it.name() to it.value().toString() }
        }
        // Add State Node
        nodes.add(nodeData)

        // Add contains Link
        if (state.isInitial) {
          links.add(mapOf("source" to smId, "target" to nodeId, "type" to "contains"))
        }

        // Collect actions from this state
        val invokeActions = state.getActionsOfType(invokeActionClass)
        val raiseActions = state.getActionsOfType(raiseActionClass)

        // Add invokes Links from state
        invokeActions.forEach { action ->
          allServiceTypes.add(action.serviceType)
          links.add(
            mapOf(
              "source" to nodeId,
              "target" to "service::${action.serviceType}",
              "type" to "invokes",
            )
          )
        }

        // Collect Raised Events
        raiseActions.forEach { action ->
          raisedEvents.add(mapOf("raisingMachine" to smId, "event" to action.event.name))
        }

        // Collect OnTransitions
        for (transition in sm.stateMachineClass.findOnTransitionsFromState(state)) {
          allOnTransitions.add(Triple(smId, transition, sm))
        }
      }

      for (transition in sm.stateMachineClass.edgeSet()) {
        val sourceState = sm.stateMachineClass.getEdgeSource(transition)
        val targetState = sm.stateMachineClass.getEdgeTarget(transition)

        if (sourceState != null && targetState != null) {
          // Add transition Link
          links.add(
            mapOf(
              "source" to "$smId::${sourceState.name}",
              "target" to "$smId::${targetState.name}",
              "type" to "transition",
            )
          )
        }

        // Collect actions from transition
        if (sourceState != null) {
          val invokeActions = transition.getActionsOfType(invokeActionClass)
          invokeActions.forEach { action ->
            allServiceTypes.add(action.serviceType)
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
    }

    // Add Service Nodes
    allServiceTypes.forEach { serviceName ->
      nodes.add(
        mapOf("id" to "service::$serviceName", "label" to serviceName, "group" to "service")
      )
    }
    // Build lookup map of raised events
    val eventRaiserMap =
      raisedEvents
        .groupBy({ it["event"] as String }, { it["raisingMachine"] as String })
        .mapValues { it.value.toSet() }

    // Process all collected transitions
    allOnTransitions.forEach { (smId, transition, sm) ->
      val eventName = transition?.eventName
      // Find all machines that raised this event
      val raisingMachines = eventRaiserMap[eventName]

      raisingMachines?.forEach { raisingMachineId ->
        links.add(
          mapOf<String, Any>(
            "source" to raisingMachineId,
            "target" to smId,
            "event" to eventName as Any,
            "type" to "event-link",
          )
        )
      }
    }

    // Convert links Set to List
    return mapOf("nodes" to nodes, "links" to links.toList())
  }

  /**
   * Broadcast message on a new service invocation
   *
   * @param sm StateMachine which invoked the service
   * @param serviceType Service which got invoked
   */
  override fun onServiceInvoked(sm: StateMachine, serviceType: String) {
    val sourceState = sm.activeState ?: return
    val sourceId = "${sm.stateMachineInstanceId}::${sourceState.stateObject.name}"

    // Create the message map
    val message =
      mapOf(
        "type" to "invocation",
        "payload" to mapOf("sourceId" to sourceId, "targetId" to "service::$serviceType"),
      )

    // Broadcast
    try {
      val jsonMessage = objectMapper.writeValueAsString(message)
      userSessions.keys.forEach { it.send(jsonMessage) }
    } catch (e: Exception) {
      println("Error broadcasting invocation: ${e.message}")
    }
  }
}
