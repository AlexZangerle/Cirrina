package at.ac.uibk.dps.cirrina.cirrina

import at.ac.uibk.dps.cirrina.execution.`object`.statemachine.StateMachine

interface InvocationListener {
  fun onServiceInvoked(sm: StateMachine, serviceType: String)
}
