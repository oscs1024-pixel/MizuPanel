import ContainerLogsModal from './src/components/ContainerLogsModal'
import CreateContainerModal from './src/components/CreateContainerModal'

console.log('ContainerLogsModal:', ContainerLogsModal)
console.log('CreateContainerModal:', CreateContainerModal)

export default function Test() {
  return (
    <>
      <ContainerLogsModal nodeId="test" containerId="test" containerName="test" open={false} onClose={() => {}} />
      <CreateContainerModal open={false} nodeId="test" onClose={() => {}} onCreate={() => {}} />
    </>
  )
}
